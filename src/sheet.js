import OBR from "@owlbear-rodeo/sdk";
import "./style.css";
import { containsMarkdown, renderFormattedMarkdown, renderInlineMarkdown } from "./markdown.js";
import { readInitiativeState, toggleTokenInitiative } from "./initiative.js";
import { appendRollHistory } from "./rollHistory.js";
import { resolveInlineRolls } from "./inlineRolls.js";
import { createThemeController } from "./theme.js";
import { ALL_SKILLS, SKILL_GROUPS } from "./skills.js";
import { calculateDefenses, evaluateSkillTest, initializeEquipment, normalizeEquipment, rollDamageExpression } from "./equipment.js";
import sheetTemplate from "../sheet.html?raw";
import sheetStyles from "./style.css?inline";
import standaloneRuntime from "./standalone-runtime.js?raw";
import { buildStandaloneHtml, extractSheetFromImport } from "./standaloneFormat.js";

const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
const SHEET_KEY = `${EXTENSION_ID}/sheet`;
const DISPLAY_SETTINGS_KEY = `${EXTENSION_ID}/display-settings`;
const COLLAPSE_STORAGE_PREFIX = `${EXTENSION_ID}/collapsed-sections`;
const TAB_STORAGE_PREFIX = `${EXTENSION_ID}/active-tab`;

const el = (id) => document.getElementById(id);
const app = el("app");
const notice = el("notice");
const selectedName = el("selected-name");
const form = el("sheet-form");
const skillsList = el("skills-list");
const visibilityButton = el("toggle-player-visibility");
const tokenNameButton = el("edit-token-name-appearance");
const nameAppearanceDialog = el("name-appearance-dialog");
const resourceSettingsDialog = el("resource-settings-dialog");
const resetSheetButton = el("reset-sheet");
const sheetOptionsDialog = el("sheet-options-dialog");
const closeSheetOptionsButton = el("close-sheet-options");
const sheetOptionDeleteButton = el("sheet-option-delete");
const sheetOptionClearButton = el("sheet-option-clear");
const sheetOptionImportButton = el("sheet-option-import");
const sheetOptionExportButton = el("sheet-option-export");
const importSheetFileInput = el("import-sheet-file");
const resetSheetDialog = el("reset-sheet-dialog");
const confirmResetSheetButton = el("confirm-reset-sheet");
const cancelResetSheetButton = el("cancel-reset-sheet");
const deleteTokenDialog = el("delete-token-dialog");
const confirmDeleteTokenButton = el("confirm-delete-token");
const cancelDeleteTokenButton = el("cancel-delete-token");
const initiativeButton = el("add-to-initiative");
const inventoryList = el("inventory-list");
const equipmentDialog = el("equipment-dialog");
let editingEquipmentId = null;
let editingEquipmentCategory = "supply";
let editingEquipmentIsNew = false;
let attackingWeaponId = null;
let defenseActiveDraft = false;
const powersList = el("powers-list");
const ritualsList = el("rituals-list");
const parametersList = el("parameters-list");
const traumasList = el("traumas-list");
const selectedTokenImage = el("selected-token-image");
const selectedTokenFallback = el("selected-token-fallback");
const themeController = createThemeController();

const ROMAN_BY_RANK = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

let activeTokenId = null;
let activeToken = null;
let activeSheet = null;
let sdkReady = false;
let currentRole = "PLAYER";
let displayedHideFlag = false;
let autoSaveTimer = null;
let saveQueue = Promise.resolve();
let unsubscribeItems = null;
let unsubscribeInitiativeMetadata = null;
let lastAccessRefresh = Promise.resolve();
const markdownPreviewTimers = new WeakMap();

function setNotice(message, type = "info") {
  notice.textContent = message;
  notice.dataset.type = type;
}

function numberFromInput(id, fallback = 0) {
  const raw = el(id).value.trim();
  if (raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : "";
}

function readOptionalNumber(id) {
  return optionalNumber(el(id).value);
}

function rankFromValue(value) {
  const rank = Number.parseInt(value, 10);
  return Number.isFinite(rank) ? Math.min(5, Math.max(1, rank)) : 1;
}

function normalizeSkills(savedSkills) {
  const savedById = new Map(
    (Array.isArray(savedSkills) ? savedSkills : [])
      .filter((skill) => skill && typeof skill.id === "string")
      .map((skill) => [skill.id, skill]),
  );

  return ALL_SKILLS.map((skill) => {
    const saved = savedById.get(skill.id);
    return { ...skill, rank: rankFromValue(saved?.rank ?? 1) };
  });
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function createEntryId(prefix = "entry") {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function normalizeInventory(items) {
  return normalizeEquipment(items);
}

function normalizeAbilities(abilities) {
  if (!Array.isArray(abilities)) return [];
  return abilities.filter((ability) => ability && typeof ability === "object").map((ability) => ({
    id: typeof ability.id === "string" && ability.id ? ability.id : createEntryId("ability"),
    name: String(ability.name ?? "").slice(0, 140),
    traits: String(ability.traits ?? "").slice(0, 500),
    description: String(ability.description ?? "").slice(0, 6000),
  }));
}

function normalizeNamedDescriptionEntries(entries, prefix) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && typeof entry === "object").map((entry) => ({
    id: typeof entry.id === "string" && entry.id ? entry.id : createEntryId(prefix),
    name: String(entry.name ?? "").slice(0, 140),
    description: String(entry.description ?? "").slice(0, 6000),
  }));
}

function normalizeSheet(sheet, fallbackName = "") {
  // Preserve older sheets and initialize the two default pieces of equipment exactly once.
  const equipmentState = initializeEquipment(sheet.inventory, Boolean(sheet.equipmentDefaultsInitialized));
  const skills = normalizeSkills(sheet.skills);
  const defenseActive = Boolean(sheet.defenseActive);
  const nameAppearanceRaw = sheet.nameAppearance && typeof sheet.nameAppearance === "object" ? sheet.nameAppearance : null;
  const nameAppearance = nameAppearanceRaw ? {
    nameSizePercent: Math.max(0, Math.min(100, Number.parseInt(nameAppearanceRaw.nameSizePercent, 10) || 0)),
    nameAlignment: ["left", "center", "right"].includes(nameAppearanceRaw.nameAlignment) ? nameAppearanceRaw.nameAlignment : "center",
    nameColor: /^#[0-9a-f]{6}$/i.test(String(nameAppearanceRaw.nameColor ?? "")) ? String(nameAppearanceRaw.nameColor).toLowerCase() : "#000000",
    nameFont: ["sans-serif", "Arial", "serif", "Georgia", "Times New Roman", "monospace", "Courier New", "cursive"].includes(nameAppearanceRaw.nameFont) ? nameAppearanceRaw.nameFont : "sans-serif",
  } : null;
  const normalized = {
    characterName: String(sheet.characterName ?? fallbackName).trim() || fallbackName || "Personagem",
    characterClass: String(sheet.characterClass ?? ""),
    organization: String(sheet.organization ?? ""),
    occupation: String(sheet.occupation ?? "").trim(),
    evolution: Math.min(100, Math.max(0, Number.parseInt(sheet.evolution, 10) || 0)),
    resourceOneNormal: nonNegativeInteger(sheet.resourceOneNormal ?? sheet.resourceOneCurrent, 0),
    resourceOneChronic: nonNegativeInteger(sheet.resourceOneChronic, 0),
    resourceOneUnconscious: Math.max(1, nonNegativeInteger(sheet.resourceOneUnconsciousAt ?? sheet.resourceOneUnconscious ?? sheet.resourceOneMax, 10)),
    resourceOneHurtAt: Math.max(1, nonNegativeInteger(sheet.resourceOneHurtAt, 5)),
    resourceOneDeadAt: Math.max(1, nonNegativeInteger(sheet.resourceOneDeadAt, 20)),
    resourceTwoNormal: nonNegativeInteger(sheet.resourceTwoNormal ?? sheet.resourceTwoCurrent, 0),
    resourceTwoChronic: nonNegativeInteger(sheet.resourceTwoChronic, 0),
    resourceTwoUnconscious: Math.max(1, nonNegativeInteger(sheet.resourceTwoLosingMindAt ?? sheet.resourceTwoUnconsciousAt ?? sheet.resourceTwoUnconscious ?? sheet.resourceTwoMax, 10)),
    resourceTwoStressedAt: Math.max(1, nonNegativeInteger(sheet.resourceTwoStressedAt, 5)),
    resourceTwoInsaneAt: Math.max(1, nonNegativeInteger(sheet.resourceTwoInsaneAt, 20)),
    hideFromPlayers: Boolean(sheet.hideFromPlayers),
    showTokenName: sheet.showTokenName !== false,
    nameAppearance,
    skills,
    inventorySpaces: nonNegativeInteger(sheet.inventorySpaces ?? sheet.inventoryMaxSpaces, 0),
    inventory: equipmentState.inventory,
    equipmentDefaultsInitialized: true,
    defenseActive,
    powers: normalizeAbilities(sheet.powers),
    rituals: normalizeAbilities(sheet.rituals),
    parameters: normalizeNamedDescriptionEntries(sheet.parameters, "parameter"),
    traumas: normalizeNamedDescriptionEntries(sheet.traumas, "trauma"),
    history: String(sheet.history ?? "").slice(0, 16000),
  };
  return { ...normalized, ...calculateDefenses(normalized) };
}

function readSheet(token) {
  const saved = token?.metadata?.[SHEET_KEY];
  return normalizeSheet(
    {
      characterName: saved?.characterName ?? token?.name ?? "",
      characterClass: saved?.characterClass ?? "",
      organization: saved?.organization ?? "",
      occupation: saved?.occupation ?? "",
      evolution: saved?.evolution ?? 1,
      resourceOneNormal: saved?.resourceOneNormal ?? saved?.resourceOneCurrent ?? 0,
      resourceOneChronic: saved?.resourceOneChronic ?? 0,
      resourceOneUnconscious: saved?.resourceOneUnconsciousAt ?? saved?.resourceOneUnconscious ?? saved?.resourceOneMax ?? 10,
      resourceOneHurtAt: saved?.resourceOneHurtAt ?? 5,
      resourceOneDeadAt: saved?.resourceOneDeadAt ?? 20,
      resourceTwoNormal: saved?.resourceTwoNormal ?? saved?.resourceTwoCurrent ?? 0,
      resourceTwoChronic: saved?.resourceTwoChronic ?? 0,
      resourceTwoUnconscious: saved?.resourceTwoLosingMindAt ?? saved?.resourceTwoUnconsciousAt ?? saved?.resourceTwoUnconscious ?? saved?.resourceTwoMax ?? 10,
      resourceTwoStressedAt: saved?.resourceTwoStressedAt ?? 5,
      resourceTwoInsaneAt: saved?.resourceTwoInsaneAt ?? 20,
      evasion: saved?.evasion ?? "",
      protection: saved?.protection ?? "",
      conviction: saved?.conviction ?? "",
      defenseActive: saved?.defenseActive ?? false,
      equipmentDefaultsInitialized: saved?.equipmentDefaultsInitialized ?? false,
      hideFromPlayers: saved?.hideFromPlayers ?? false,
      showTokenName: saved?.showTokenName !== false,
      nameAppearance: saved?.nameAppearance,
      skills: saved?.skills,
      inventorySpaces: saved?.inventorySpaces ?? saved?.inventoryMaxSpaces ?? 0,
      inventory: saved?.inventory,
      powers: saved?.powers,
      rituals: saved?.rituals,
      parameters: saved?.parameters,
      traumas: saved?.traumas,
      history: saved?.history ?? "",
    },
    token?.name ?? "Personagem",
  );
}

function readSkillsFromForm() {
  const rankInputs = [...skillsList.querySelectorAll("[data-skill-rank]")];
  const rankById = new Map(rankInputs.map((input) => [input.dataset.skillRank, rankFromValue(input.value)]));
  return ALL_SKILLS.map((skill) => ({
    ...skill,
    rank: rankById.get(skill.id) ?? 1,
  }));
}

function readSheetFromForm(token) {
  const saved = token?.metadata?.[SHEET_KEY];
  return normalizeSheet(
    {
      characterName: el("character-name").value.trim() || token?.name || "Personagem",
      characterClass: el("character-class").value,
      organization: el("character-organization").value,
      occupation: el("character-occupation").value.trim(),
      evolution: Math.min(100, numberFromInput("character-evolution", 1)),
      resourceOneNormal: numberFromInput("resource-one-normal", 0),
      resourceOneChronic: numberFromInput("resource-one-chronic", 0),
      resourceOneUnconscious: numberFromInput("resource-one-unconscious", 10),
      resourceOneHurtAt: numberFromInput("resource-one-hurt-at", 5),
      resourceOneDeadAt: numberFromInput("resource-one-dead-at", 20),
      resourceTwoNormal: numberFromInput("resource-two-normal", 0),
      resourceTwoChronic: numberFromInput("resource-two-chronic", 0),
      resourceTwoUnconscious: numberFromInput("resource-two-unconscious", 10),
      resourceTwoStressedAt: numberFromInput("resource-two-stressed-at", 5),
      resourceTwoInsaneAt: numberFromInput("resource-two-insane-at", 20),
      evasion: readOptionalNumber("character-evasion"),
      protection: readOptionalNumber("character-protection"),
      conviction: readOptionalNumber("character-conviction"),
      defenseActive: defenseActiveDraft,
      equipmentDefaultsInitialized: true,
      hideFromPlayers: Boolean(saved?.hideFromPlayers),
      showTokenName: saved?.showTokenName !== false,
      nameAppearance: saved?.nameAppearance,
      skills: readSkillsFromForm(),
      inventorySpaces: numberFromInput("inventory-spaces", 0),
      inventory: readInventoryFromForm(),
      powers: readAbilitiesFromForm(powersList),
      rituals: readAbilitiesFromForm(ritualsList),
      parameters: readNamedDescriptionEntriesFromForm(parametersList),
      traumas: readNamedDescriptionEntriesFromForm(traumasList),
      history: el("character-history").value.slice(0, 16000),
    },
    token?.name ?? "Personagem",
  );
}

function readInventoryFromForm() {
  return [...inventoryList.querySelectorAll("[data-inventory-card]")].map((card) => {
    const item = card._equipmentData && typeof card._equipmentData === "object" ? card._equipmentData : {};
    const spaces = card.querySelector('[data-inventory-field="spaces"]');
    return normalizeInventory([{
      ...item,
      id: card.dataset.inventoryId || item.id || createEntryId("item"),
      spaces: spaces ? spaces.value : item.spaces,
    }])[0];
  }).filter(Boolean);
}

function readAbilitiesFromForm(container) {
  return [...container.querySelectorAll("[data-ability-card]")].map((card) => ({
    id: card.dataset.abilityId || createEntryId("ability"),
    name: card.querySelector('[data-ability-field="name"]').value.trim().slice(0, 140),
    traits: card.querySelector('[data-ability-field="traits"]').value.trim().slice(0, 500),
    description: card.querySelector('[data-ability-field="description"]').value.slice(0, 6000),
  }));
}

function readNamedDescriptionEntriesFromForm(container) {
  return [...container.querySelectorAll("[data-profile-card]")].map((card) => ({
    id: card.dataset.profileId || createEntryId(card.dataset.profileKind || "profile"),
    name: card.querySelector('[data-profile-field="name"]').value.trim().slice(0, 140),
    description: card.querySelector('[data-profile-field="description"]').value.slice(0, 6000),
  }));
}

function isMarkdownEditor(element) {
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type === "text");
}

function makeFormattedEditor(element) {
  const wrapper = document.createElement("div");
  wrapper.className = "formatted-editor";
  const replaceMode = element.dataset.formatReplace === "true";
  if (replaceMode) wrapper.dataset.replaceMode = "true";
  element.dataset.markdownEditor = "true";
  const preview = document.createElement("div");
  preview.className = "markdown-preview";
  preview.hidden = replaceMode;
  preview.tabIndex = replaceMode ? 0 : -1;
  preview.setAttribute("aria-label", replaceMode ? "Conteúdo formatado. Clique para editar." : "Prévia da formatação");
  wrapper.append(element, preview);
  if (replaceMode) updateMarkdownPreview(element);
  return wrapper;
}

function makeField(labelText, input, extraClass = "") {
  const label = document.createElement("label");
  label.className = `field entry-field ${extraClass}`.trim();
  const labelTextElement = document.createElement("span");
  labelTextElement.textContent = labelText;
  label.append(labelTextElement, isMarkdownEditor(input) ? makeFormattedEditor(input) : input);
  return label;
}

function attachStaticMarkdownEditors() {
  for (const editor of [...form.querySelectorAll('input[type="text"], textarea')]) {
    if (editor.dataset.identityPreviewField === "true") continue;
    if (editor.closest("#equipment-dialog")) continue;
    if (editor.closest(".formatted-editor")) continue;
    const parent = editor.parentNode;
    const nextSibling = editor.nextSibling;
    if (editor instanceof HTMLTextAreaElement) editor.dataset.formatReplace = "true";
    const wrapper = makeFormattedEditor(editor);
    parent.insertBefore(wrapper, nextSibling);
  }
}

function scheduleMarkdownPreview(editor) {
  // Replace-mode fields remain editable until the user clicks outside them.
  // Non-replacing fields may still show an additional Markdown hint preview.
  if (editor.dataset.formatReplace === "true") return;
  const preview = editor.closest(".formatted-editor")?.querySelector(".markdown-preview");
  if (!preview) return;
  const existing = markdownPreviewTimers.get(editor);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    markdownPreviewTimers.delete(editor);
    updateMarkdownPreview(editor);
  }, 650);
  markdownPreviewTimers.set(editor, timer);
}

function renderTraitsPreview(preview, source, editor) {
  preview.replaceChildren();
  preview.classList.add("traits-preview");
  const traits = String(source ?? "").split(/[;,]/).map((trait) => trait.trim()).filter(Boolean).slice(0, 20);
  if (!traits.length) {
    const placeholder = document.createElement("span");
    placeholder.className = "markdown-placeholder";
    placeholder.textContent = editor.placeholder || "Clique para adicionar traços…";
    preview.append(placeholder);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const traitText of traits) {
    const trait = document.createElement("span");
    trait.className = "ability-trait";
    renderInlineMarkdown(trait, traitText.slice(0, 80));
    fragment.append(trait);
  }
  preview.append(fragment);
}

function updateMarkdownPreview(editor) {
  const wrapper = editor.closest(".formatted-editor");
  const preview = wrapper?.querySelector(".markdown-preview");
  if (!preview) return;
  const source = editor.value ?? "";

  if (wrapper.dataset.replaceMode === "true") {
    if (editor.matches('[data-ability-field="traits"]')) {
      renderTraitsPreview(preview, source, editor);
    } else if (!source.trim()) {
      preview.classList.remove("traits-preview");
      preview.replaceChildren();
      const placeholder = document.createElement("span");
      placeholder.className = "markdown-placeholder";
      placeholder.textContent = editor.placeholder || "Clique para editar…";
      preview.append(placeholder);
    } else {
      preview.classList.remove("traits-preview");
      const markdownOptions = editor.matches('[data-ability-field="description"]')
        ? { skillValues: readSkillsFromForm() }
        : {};
      renderFormattedMarkdown(preview, source, markdownOptions);
    }
    editor.hidden = true;
    preview.hidden = false;
    wrapper.classList.add("is-preview-mode");
    return;
  }

  if (!containsMarkdown(source)) {
    preview.hidden = true;
    preview.replaceChildren();
    return;
  }
  const markdownOptions = editor.matches('[data-ability-field="description"]')
    ? { skillValues: readSkillsFromForm() }
    : {};
  renderFormattedMarkdown(preview, source, markdownOptions);
  preview.hidden = false;
}

function enterMarkdownEdit(editor) {
  const wrapper = editor?.closest('.formatted-editor[data-replace-mode="true"]');
  if (!wrapper || editor.disabled) return;
  const preview = wrapper.querySelector(".markdown-preview");
  wrapper.classList.remove("is-preview-mode");
  preview.hidden = true;
  editor.hidden = false;
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || (editor instanceof HTMLInputElement && editor.type === "text")) {
    try { editor.setSelectionRange(editor.value.length, editor.value.length); } catch { /* Selection APIs vary by input type. */ }
  }
}

function leaveMarkdownEdit(editor) {
  const wrapper = editor?.closest('.formatted-editor[data-replace-mode="true"]');
  if (!wrapper || wrapper.classList.contains("is-preview-mode")) return;
  updateMarkdownPreview(editor);
  scheduleAutoSave();
}

function leaveMarkdownEditorsOutside(target) {
  for (const wrapper of form.querySelectorAll('.formatted-editor[data-replace-mode="true"]:not(.is-preview-mode)')) {
    if (wrapper.contains(target)) continue;
    const editor = wrapper.querySelector("input, textarea");
    if (editor) leaveMarkdownEdit(editor);
  }
}

function refreshMarkdownPreviews(root = form) {
  for (const editor of root.querySelectorAll("[data-markdown-editor]")) updateMarkdownPreview(editor);
}

function makeInput({ value = "", type = "text", placeholder = "", maxLength, min, max, field, className = "" } = {}) {
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.className = className;
  input.autocomplete = "off";
  if (Number.isFinite(maxLength)) input.maxLength = maxLength;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (field) input.dataset[field[0]] = field[1];
  if (type === "text") input.dataset.markdownEditor = "true";
  const replaceFields = new Set([
    "inventoryField:name",
    "abilityField:name",
    "abilityField:traits",
    "profileField:name",
  ]);
  if (field && replaceFields.has(`${field[0]}:${field[1]}`)) input.dataset.formatReplace = "true";
  return input;
}

function makeTextarea({ value = "", placeholder = "", rows = 3, maxLength, field } = {}) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.placeholder = placeholder;
  textarea.rows = rows;
  textarea.maxLength = maxLength ?? 6000;
  textarea.dataset[field[0]] = field[1];
  textarea.dataset.markdownEditor = "true";
  textarea.dataset.formatReplace = "true";
  return textarea;
}

function makeSmallButton(label, className, actionAttribute) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.dataset[actionAttribute] = "true";
  return button;
}

function signedLabel(value, label) {
  const number = Number.parseInt(value, 10) || 0;
  return `${label} ${number > 0 ? "+" : ""}${number}`;
}

function renderInventory(items) {
  const listByCategory = {
    weapon: el("weapons-list"),
    armor: el("armor-list"),
    supply: el("supplies-list"),
  };
  const normalized = normalizeInventory(items);
  for (const [category, list] of Object.entries(listByCategory)) {
    if (!list) continue;
    const fragment = document.createDocumentFragment();
    const matches = normalized.filter((item) => item.category === category);
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state equipment-empty-state";
      empty.textContent = category === "weapon" ? "Nenhuma arma." : category === "armor" ? "Nenhuma armadura ou escudo." : "Nenhum suprimento.";
      fragment.append(empty);
    }
    for (const item of matches) {
      const card = document.createElement("article");
      card.className = `equipment-card equipment-card-${category}`;
      card.dataset.inventoryCard = "true";
      card.dataset.inventoryId = item.id;
      card.dataset.inventoryCategory = category;
      card._equipmentData = { ...item };

      const spacesInput = document.createElement("input");
      spacesInput.type = "hidden";
      spacesInput.dataset.inventoryField = "spaces";
      spacesInput.value = String(item.spaces ?? 0);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "equipment-card-main";
      main.dataset.equipmentAction = "edit";
      const title = document.createElement("span");
      title.className = "equipment-card-title";
      title.textContent = item.name || (category === "weapon" ? "Nova arma" : category === "armor" ? "Novo equipamento defensivo" : "Novo suprimento");
      const meta = document.createElement("span");
      meta.className = "equipment-card-meta";
      if (category === "weapon") {
        meta.textContent = item.skill === "armas-de-fogo" ? "Armas de Fogo" : "Armas Simples";
        const traits = document.createElement("span");
        traits.className = "equipment-card-traits";
        for (const traitText of [`Dano ${item.damage || "—"}`, `Críticos ${item.critical || "—"}`]) {
          const trait = document.createElement("span");
          trait.className = "ability-trait";
          trait.textContent = traitText;
          traits.append(trait);
        }
        const metaAndTraits = document.createElement("span");
        metaAndTraits.className = "equipment-card-meta-stack";
        metaAndTraits.append(meta, traits);
        main.append(title, metaAndTraits);
      } else if (category === "armor") {
        const traits = document.createElement("span");
        traits.className = "equipment-card-traits";
        const signed = (value) => `${Number(value) > 0 ? "+" : ""}${Number(value) || 0}`;
        const values = item.armorKind === "escudo"
          ? [`Evasão ${signed(item.evasionBonus)}`, `Proteção ${signed(item.protectionBonus)}`, `Defesa ativa: EVA ${signed(item.activeEvasion)}`, `Defesa ativa: PRO ${signed(item.activeProtection)}`]
          : [`Evasão ${item.evasionBase} + Agilidade`, `Proteção ${item.protectionBase} + Fortitude`, `Defesa ativa: EVA ${signed(item.activeEvasion)}`, `Defesa ativa: PRO ${signed(item.activeProtection)}`];
        for (const traitText of values) {
          const trait = document.createElement("span");
          trait.className = "ability-trait";
          trait.textContent = traitText;
          traits.append(trait);
        }
        const metaAndTraits = document.createElement("span");
        metaAndTraits.className = "equipment-card-meta-stack";
        meta.textContent = item.armorKind === "escudo" ? "Escudo" : "Armadura";
        metaAndTraits.append(meta, traits);
        main.append(title, metaAndTraits);
      } else {
        meta.textContent = item.usesEnabled ? `Usos restantes: ${item.uses}` : "";
        main.append(title, meta);
      }

      const actions = document.createElement("div");
      actions.className = "equipment-card-actions";
      if (category === "weapon") {
        const attack = makeSmallButton("Atacar", "equipment-action-button equipment-attack-button", "equipmentAction");
        attack.dataset.equipmentAction = "attack";
        attack.title = `Atacar com ${item.name || "arma"}`;
        actions.append(attack);
        if ((item.defletir ?? item.reactionEvasion ?? 0) !== 0 || (item.aparar ?? item.reactionProtection ?? 0) !== 0) {
          const reaction = makeSmallButton(item.reactionActive ? "Reação ativa" : "Reagir", "equipment-action-button", "equipmentAction");
          reaction.dataset.equipmentAction = "reaction";
          reaction.setAttribute("aria-pressed", String(Boolean(item.reactionActive)));
          actions.append(reaction);
        }
      } else if (category === "armor") {
        const equip = makeSmallButton(item.equipped ? "Em uso" : "Equipar", `equipment-action-button ${item.equipped ? "is-equipped" : ""}`, "equipmentAction");
        equip.dataset.equipmentAction = "toggle-equipped";
        equip.setAttribute("aria-pressed", String(Boolean(item.equipped)));
        actions.append(equip);
      } else if (item.usesEnabled && String(item.uses ?? "").trim() !== "") {
        const decrement = makeSmallButton("−", "equipment-uses-step", "equipmentAction");
        decrement.dataset.equipmentAction = "uses-down";
        decrement.setAttribute("aria-label", `Diminuir usos de ${item.name}`);
        const uses = document.createElement("output");
        uses.className = "equipment-uses-count";
        uses.textContent = item.uses;
        uses.setAttribute("aria-label", "Usos restantes");
        const increment = makeSmallButton("+", "equipment-uses-step", "equipmentAction");
        increment.dataset.equipmentAction = "uses-up";
        increment.setAttribute("aria-label", `Aumentar usos de ${item.name}`);
        actions.append(decrement, uses, increment);
      }
      const remove = makeSmallButton("×", "remove-entry-button remove-icon-button equipment-remove-button", "removeInventory");
      remove.title = "Remover equipamento";
      remove.setAttribute("aria-label", `Remover ${item.name || "equipamento"}`);
      actions.append(remove);
      card.append(spacesInput, main, actions);
      if (item.description?.trim()) {
        const description = document.createElement("div");
        description.className = "equipment-card-description ability-description";
        renderFormattedMarkdown(description, item.description);
        card.append(description);
      }
      fragment.append(card);
    }
    list.replaceChildren(fragment);
  }
  updateInventorySpaceTotal();
  updateDefenseDisplay();
}

function renderAbilityList(container, abilities, kind) {
  const fragment = document.createDocumentFragment();
  if (!abilities.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = kind === "power" ? "Nenhum poder cadastrado." : "Nenhum ritual cadastrado.";
    fragment.append(empty);
  }

  for (const ability of abilities) {
    const card = document.createElement("article");
    card.className = "ability-entry";
    card.dataset.abilityCard = "true";
    card.dataset.abilityId = ability.id;
    card.dataset.abilityKind = kind;

    const top = document.createElement("div");
    top.className = "ability-entry-top";
    const name = makeInput({ value: ability.name, placeholder: kind === "power" ? "Nome do poder" : "Nome do ritual", maxLength: 140, field: ["abilityField", "name"] });
    name.className = "ability-name-input";
    name.setAttribute("aria-label", kind === "power" ? "Nome do poder" : "Nome do ritual");
    const actions = document.createElement("div");
    actions.className = "ability-entry-actions";
    const use = makeSmallButton("Usar", "use-ability-button", "useAbility");
    use.title = `Compartilhar ${kind === "power" ? "poder" : "ritual"}`;
    const remove = makeSmallButton("×", "remove-entry-button remove-icon-button", "removeAbility");
    remove.title = "Remover entrada";
    remove.setAttribute("aria-label", "Remover entrada");
    actions.append(use, remove);
    top.append(makeFormattedEditor(name), actions);

    const traits = makeInput({ value: ability.traits, placeholder: "Ação, Visual, Teste Mental", maxLength: 500, field: ["abilityField", "traits"] });
    traits.setAttribute("aria-label", "Traços da habilidade");
    const traitsField = makeField("Traços", traits, "ability-traits-field");

    const description = makeTextarea({ value: ability.description, placeholder: "Descrição da habilidade…", rows: 4, maxLength: 6000, field: ["abilityField", "description"] });
    description.className = "ability-description-input";
    description.setAttribute("aria-label", "Descrição da habilidade");
    const descriptionField = makeField("Descrição", description, "ability-description-field");

    card.append(top, traitsField, descriptionField);
    fragment.append(card);
  }
  container.replaceChildren(fragment);
}

function renderEntryLists(sheet) {
  renderInventory(sheet.inventory);
  renderAbilityList(powersList, sheet.powers, "power");
  renderAbilityList(ritualsList, sheet.rituals, "ritual");
  renderProfileEntryList(parametersList, sheet.parameters, "parameter");
  renderProfileEntryList(traumasList, sheet.traumas, "trauma");
}

function updateInventorySpaceTotal() {
  const total = [...inventoryList.querySelectorAll("[data-inventory-card]")].reduce((sum, card) => {
    const spaces = nonNegativeInteger(card.querySelector('[data-inventory-field="spaces"]')?.value, 0);
    return sum + spaces;
  }, 0);
  const limit = nonNegativeInteger(el("inventory-spaces")?.value, 0);
  const output = el("inventory-spaces-used");
  if (!output) return;
  output.textContent = `${total}/${limit}`;
  output.classList.toggle("over-capacity", total > limit);
  output.setAttribute("aria-label", `${total} espaços ocupados de ${limit} disponíveis`);
}

function currentEquipmentData() {
  return {
    skills: readSkillsFromForm(),
    inventory: readInventoryFromForm(),
    defenseActive: defenseActiveDraft,
  };
}

function updateDefenseDisplay(sheet = null) {
  const source = sheet ?? currentEquipmentData();
  const values = calculateDefenses(source);
  const rows = [
    ["evasion", "defense-evasion-value", "character-evasion"],
    ["protection", "defense-protection-value", "character-protection"],
    ["conviction", "defense-conviction-value", "character-conviction"],
  ];
  for (const [key, outputId, inputId] of rows) {
    if (el(outputId)) el(outputId).textContent = String(values[key]);
    if (el(inputId)) el(inputId).value = String(values[key]);
  }
  const button = el("defense-active-toggle");
  const status = el("defense-active-status");
  if (button) {
    button.classList.toggle("is-active", Boolean(source.defenseActive));
    button.setAttribute("aria-pressed", String(Boolean(source.defenseActive)));
    button.textContent = source.defenseActive ? "Defesa Ativa · Desativar" : "Defesa Ativa";
  }
  if (status) {
    const equipped = (source.inventory ?? []).filter((item) => item.category === "armor" && item.equipped);
    const evasionBonus = source.defenseActive ? equipped.reduce((sum, item) => sum + (Number(item.activeEvasion) || 0), 0) : 0;
    const protectionBonus = source.defenseActive ? equipped.reduce((sum, item) => sum + (Number(item.activeProtection) || 0), 0) : 0;
    status.hidden = !source.defenseActive;
    status.textContent = source.defenseActive ? `Bônus ativos: EVA ${evasionBonus >= 0 ? "+" : ""}${evasionBonus} · PRO ${protectionBonus >= 0 ? "+" : ""}${protectionBonus}` : "";
  }
  return values;
}

function updateArmorEditorLabels(kind = el("equipment-armor-kind")?.value) {
  const shield = kind === "escudo";
  el("equipment-evasion-label").textContent = shield ? "Bônus de Evasão" : "Base de Evasão";
  el("equipment-protection-label").textContent = shield ? "Bônus de Proteção" : "Base de Proteção";
  el("equipment-armor-formula").textContent = shield
    ? "Os bônus do escudo são somados à defesa calculada pela armadura."
    : "Evasão = base + Agilidade · Proteção = base + Fortitude";
}

function openEquipmentEditor(category, item, { isNew = false } = {}) {
  if (!item || !equipmentDialog) return;
  editingEquipmentId = item.id;
  editingEquipmentCategory = category;
  editingEquipmentIsNew = isNew;
  el("equipment-dialog-title").textContent = category === "weapon" ? "Arma" : category === "armor" ? "Armadura ou escudo" : "Suprimento";
  el("equipment-name").value = item.name ?? "";
  el("equipment-description").value = item.description ?? "";
  el("weapon-editor-fields").hidden = category !== "weapon";
  el("armor-editor-fields").hidden = category !== "armor";
  el("supply-editor-fields").hidden = category !== "supply";
  const spacesField = el("equipment-spaces-field");
  const targetFields = category === "weapon" ? el("weapon-editor-fields") : category === "armor" ? el("armor-editor-fields") : el("supply-editor-fields");
  if (category === "weapon") {
    targetFields.insertBefore(spacesField, el("equipment-damage").closest(".equipment-field"));
  } else if (category === "armor") {
    targetFields.append(spacesField);
  } else {
    targetFields.append(spacesField);
  }
  el("equipment-spaces").value = String(item.spaces ?? (category === "supply" ? 1 : 0));
  el("equipment-weapon-skill").value = item.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples";
  el("equipment-damage").value = item.damage ?? "";
  el("equipment-critical").value = item.critical ?? "";
  el("equipment-reaction-evasion").value = String(item.defletir ?? item.reactionEvasion ?? 0);
  el("equipment-reaction-protection").value = String(item.aparar ?? item.reactionProtection ?? 0);
  el("equipment-armor-kind").value = item.armorKind === "escudo" ? "escudo" : "armadura";
  el("equipment-equipped").checked = Boolean(item.equipped);
  el("equipment-evasion-bonus").value = String(item.armorKind === "escudo" ? item.evasionBonus ?? 0 : item.evasionBase ?? (item.defaultEquipmentKey === "no-armor" ? 4 : 0));
  el("equipment-protection-bonus").value = String(item.armorKind === "escudo" ? item.protectionBonus ?? 0 : item.protectionBase ?? 0);
  el("equipment-active-evasion").value = String(item.activeEvasion ?? 0);
  el("equipment-active-protection").value = String(item.activeProtection ?? 0);
  el("equipment-uses-enabled").checked = Boolean(item.usesEnabled ?? (item.uses !== "" && item.uses != null));
  el("equipment-uses").value = item.uses === "" || item.uses === null || item.uses === undefined ? "" : String(item.uses);
  el("equipment-uses-field").hidden = !el("equipment-uses-enabled").checked;
  updateArmorEditorLabels();
  if (typeof equipmentDialog.showModal === "function") equipmentDialog.showModal();
  el("equipment-name").focus();
}

function saveEquipmentEditor() {
  if (!editingEquipmentId || isRestricted()) return;
  const name = el("equipment-name").value.trim().slice(0, 140);
  if (!name) {
    el("equipment-name").focus();
    setNotice("Informe o nome do equipamento.", "warning");
    return;
  }
  if (editingEquipmentCategory === "weapon") {
    if (!el("equipment-damage").value.trim() || el("equipment-critical").value.trim() === "") {
      setNotice("Preencha Dano e Críticos da arma.", "warning");
      (!el("equipment-damage").value.trim() ? el("equipment-damage") : el("equipment-critical")).focus();
      return;
    }
  }
  const spaces = Math.max(0, Math.min(9999, nonNegativeInteger(el("equipment-spaces").value, 0)));
  let item = readInventoryFromForm().find((entry) => entry.id === editingEquipmentId);
  if (!item) return;
  item = { ...item, name, spaces, description: el("equipment-description").value.slice(0, 4000) };
  if (editingEquipmentCategory === "weapon") {
    item = {
      ...item,
      skill: el("equipment-weapon-skill").value === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples",
      damage: el("equipment-damage").value.trim().slice(0, 100),
      critical: String(Math.max(0, Math.min(99, Number.parseInt(el("equipment-critical").value, 10) || 0))),
      defletir: Math.max(-99, Math.min(99, Number.parseInt(el("equipment-reaction-evasion").value, 10) || 0)),
      aparar: Math.max(-99, Math.min(99, Number.parseInt(el("equipment-reaction-protection").value, 10) || 0)),
    };
  } else if (editingEquipmentCategory === "armor") {
    const equipped = el("equipment-equipped").checked;
    const armorKind = el("equipment-armor-kind").value === "escudo" ? "escudo" : "armadura";
    if (equipped && armorKind === "armadura") {
      for (const other of readInventoryFromForm()) {
        if (other.id !== item.id && other.category === "armor" && other.armorKind !== "escudo") other.equipped = false;
      }
    }
    const defenseValueEvasion = Math.max(-99, Math.min(99, Number.parseInt(el("equipment-evasion-bonus").value, 10) || 0));
    const defenseValueProtection = Math.max(-99, Math.min(99, Number.parseInt(el("equipment-protection-bonus").value, 10) || 0));
    item = {
      ...item, armorKind, equipped,
      evasionBase: armorKind === "armadura" ? defenseValueEvasion : (item.evasionBase ?? 4),
      protectionBase: armorKind === "armadura" ? defenseValueProtection : (item.protectionBase ?? 0),
      evasionBonus: armorKind === "escudo" ? defenseValueEvasion : 0,
      protectionBonus: armorKind === "escudo" ? defenseValueProtection : 0,
      activeEvasion: Math.max(-99, Math.min(99, Number.parseInt(el("equipment-active-evasion").value, 10) || 0)),
      activeProtection: Math.max(-99, Math.min(99, Number.parseInt(el("equipment-active-protection").value, 10) || 0)),
    };
  } else {
    const usesEnabled = el("equipment-uses-enabled").checked;
    const rawUses = String(el("equipment-uses").value ?? "").trim();
    item.usesEnabled = usesEnabled;
    item.uses = !usesEnabled ? "" : String(Math.max(0, Math.min(9999, rawUses === "" ? 1 : (Number.parseInt(rawUses, 10) || 0))));
  }
  const entries = readInventoryFromForm().map((entry) => entry.id === item.id ? item : entry);
  if (editingEquipmentCategory === "armor" && item.equipped && item.armorKind === "armadura") {
    for (const entry of entries) {
      if (entry.id !== item.id && entry.category === "armor" && entry.armorKind !== "escudo") entry.equipped = false;
    }
  }
  renderInventory(entries);
  editingEquipmentIsNew = false;
  equipmentDialog.close();
  editingEquipmentId = null;
  scheduleAutoSave();
  setNotice("Equipamento salvo.", "success");
}

function cancelEquipmentEditor() {
  if (editingEquipmentIsNew && editingEquipmentId) {
    const remaining = readInventoryFromForm().filter((entry) => entry.id !== editingEquipmentId);
    renderInventory(remaining);
    scheduleAutoSave();
  }
  editingEquipmentIsNew = false;
  editingEquipmentId = null;
  if (equipmentDialog?.open) equipmentDialog.close();
}

function toggleEquipmentEquipped(card) {
  const target = card?._equipmentData;
  if (!target || target.category !== "armor" || isRestricted()) return;
  const entries = readInventoryFromForm();
  const item = entries.find((entry) => entry.id === target.id);
  if (!item) return;
  item.equipped = !item.equipped;
  if (item.equipped && item.armorKind !== "escudo") {
    for (const entry of entries) {
      if (entry.id !== item.id && entry.category === "armor" && entry.armorKind !== "escudo") entry.equipped = false;
    }
  }
  renderInventory(entries);
  scheduleAutoSave();
}

function toggleWeaponReaction(card) {
  const target = card?._equipmentData;
  if (!target || target.category !== "weapon" || isRestricted()) return;
  const entries = readInventoryFromForm();
  const item = entries.find((entry) => entry.id === target.id);
  if (!item) return;
  item.reactionActive = !item.reactionActive;
  renderInventory(entries);
  scheduleAutoSave();
}

function adjustSupplyUses(card, delta) {
  const target = card?._equipmentData;
  if (!target || target.category !== "supply" || String(target.uses ?? "").trim() === "" || isRestricted()) return;
  const entries = readInventoryFromForm();
  const item = entries.find((entry) => entry.id === target.id);
  if (!item) return;
  item.uses = String(Math.max(0, Math.min(9999, Number.parseInt(item.uses, 10) + delta)));
  renderInventory(entries);
  scheduleAutoSave();
}

async function toggleDefenseActive() {
  if (isRestricted()) return;
  defenseActiveDraft = !defenseActiveDraft;
  updateDefenseDisplay();
  scheduleAutoSave();
  setNotice(defenseActiveDraft ? "Defesa Ativa aplicada." : "Defesa Ativa encerrada.", "success");
}

async function openWeaponAttack(item) {
  if (!item || item.category !== "weapon" || isRestricted() || !activeTokenId || !activeToken) return;
  try {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    await queueAutoSave();
    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    activeToken = latestItems[0] ?? activeToken;
    const sheet = readSheetFromForm(activeToken);
    const weapon = sheet.inventory.find((entry) => entry.id === item.id && entry.category === "weapon");
    if (!weapon) throw new Error("A arma não foi encontrada na ficha.");
    const skillId = weapon.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples";
    const skill = ALL_SKILLS.find((entry) => entry.id === skillId);
    const rank = rankFromValue(sheet.skills.find((entry) => entry.id === skillId)?.rank ?? 1);
    const dice = Array.from({ length: rank }, secureRandomD10).sort((a, b) => b - a).map((value) => ({ rolls: [value] }));
    const strength = rankFromValue(sheet.skills.find((entry) => entry.id === "forca")?.rank ?? 1);
    let playerName = "Jogador";
    try { playerName = (await OBR.player.getName()) || "Jogador"; } catch { /* keep fallback */ }
    await appendRollHistory({
      type: "weapon-attack",
      id: createEntryId("weapon-attack"),
      characterName: sheet.characterName,
      playerName,
      tokenId: activeTokenId,
      weaponName: weapon.name || "Arma sem nome",
      skillName: skill?.name ?? "Armas Simples",
      skillId,
      rank,
      dice,
      dt: null,
      damageExpression: weapon.damage,
      criticalBonus: Number.parseInt(weapon.critical, 10) || 0,
      strength,
      description: weapon.description ?? "",
      damageRolls: [],
      damageTotal: null,
    });
    setNotice(`Ataque com ${weapon.name} enviado ao CHAT. Preencha a DT na rolagem.`, "success");
  } catch (error) {
    console.error("A&A: falha ao realizar ataque com arma.", error);
    setNotice(error?.message || "Não foi possível registrar o ataque.", "error");
  }
}

function openInventorySpacesEditor() {
  const summary = el("inventory-spaces-used");
  const editor = el("inventory-spaces-editor");
  const limit = el("inventory-spaces");
  if (!summary || !editor || !limit || summary.hidden) return;
  editor.value = String(nonNegativeInteger(limit.value, 0));
  summary.hidden = true;
  editor.hidden = false;
  editor.focus();
  editor.select();
}

function closeInventorySpacesEditor({ save = true, restoreFocus = false } = {}) {
  const summary = el("inventory-spaces-used");
  const editor = el("inventory-spaces-editor");
  const limit = el("inventory-spaces");
  if (!summary || !editor || !limit || editor.hidden) return;

  if (save) {
    const rawValue = String(editor.value ?? "").trim();
    const value = rawValue === "" ? NaN : Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      limit.value = String(Math.min(9999, Math.trunc(value)));
      updateInventorySpaceTotal();
      scheduleAutoSave();
    } else {
      editor.value = String(nonNegativeInteger(limit.value, 0));
    }
  }

  editor.hidden = true;
  summary.hidden = false;
  if (restoreFocus) summary.focus();
}

function renderProfileEntryList(container, entries, kind) {
  const fragment = document.createDocumentFragment();
  const title = kind === "parameter" ? "parâmetro" : "trauma";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = kind === "parameter" ? "Nenhum parâmetro cadastrado." : "Nenhum trauma cadastrado.";
    fragment.append(empty);
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "profile-entry";
    card.dataset.profileCard = "true";
    card.dataset.profileId = entry.id;
    card.dataset.profileKind = kind;

    const top = document.createElement("div");
    top.className = "profile-entry-top";
    const name = makeInput({ value: entry.name, placeholder: kind === "parameter" ? "Nome do parâmetro" : "Nome do trauma", maxLength: 140, field: ["profileField", "name"] });
    name.setAttribute("aria-label", kind === "parameter" ? "Nome do parâmetro" : "Nome do trauma");
    const remove = makeSmallButton("×", "remove-entry-button remove-icon-button", "removeProfileEntry");
    remove.title = `Remover ${title}`;
    remove.setAttribute("aria-label", `Remover ${title}`);
    top.append(makeFormattedEditor(name), remove);

    const description = makeTextarea({ value: entry.description, placeholder: `Descrição do ${title}…`, rows: 4, maxLength: 6000, field: ["profileField", "description"] });
    description.setAttribute("aria-label", `Descrição do ${title}`);
    const descriptionField = makeField("Descrição", description, "profile-description-field");
    card.append(top, descriptionField);
    fragment.append(card);
  }
  container.replaceChildren(fragment);
}

function renderSkills(skills) {
  const rankById = new Map(skills.map((skill) => [skill.id, rankFromValue(skill.rank)]));
  const fragment = document.createDocumentFragment();

  for (const group of SKILL_GROUPS) {
    const section = document.createElement("section");
    section.className = "skill-group";

    const heading = document.createElement("div");
    heading.className = "skill-group-heading";

    const title = document.createElement("h3");
    title.className = "skill-group-title collapsible-heading-toggle";
    title.textContent = group.name;

    const contentId = `skills-group-${group.skills[0].id}`;
    title.dataset.collapseTarget = contentId;
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-expanded", "true");
    title.setAttribute("aria-controls", contentId);
    heading.append(title);
    section.append(heading);

    const content = document.createElement("div");
    content.className = "skill-group-content collapsible-content";
    content.id = contentId;

    for (const skill of group.skills) {
      const row = document.createElement("div");
      row.className = "skill-row";

      const button = document.createElement("button");
      button.className = "skill-roll-button";
      button.type = "button";
      button.dataset.rollSkill = skill.id;
      button.textContent = skill.name;
      button.title = `Rolar ${ROMAN_BY_RANK[rankById.get(skill.id) ?? 1]} (${rankById.get(skill.id) ?? 1}d10)`;

      const select = document.createElement("select");
      select.className = "skill-rank";
      select.dataset.skillRank = skill.id;
      select.setAttribute("aria-label", `Treinamento em ${skill.name}`);
      for (let rank = 1; rank <= 5; rank += 1) {
        const option = document.createElement("option");
        option.value = String(rank);
        option.textContent = ROMAN_BY_RANK[rank];
        option.selected = rank === (rankById.get(skill.id) ?? 1);
        select.append(option);
      }
      select.addEventListener("change", () => {
        updateSkillButtonTitles();
        refreshMarkdownPreviews();
        scheduleAutoSave();
      });

      row.append(button, select);
      content.append(row);
    }

    section.append(content);
    fragment.append(section);
  }

  skillsList.replaceChildren(fragment);
  updateSkillButtonTitles();
}

function updateSkillButtonTitles() {
  for (const button of skillsList.querySelectorAll("[data-roll-skill]")) {
    const id = button.dataset.rollSkill;
    const select = skillsList.querySelector(`[data-skill-rank="${CSS.escape(id)}"]`);
    const rank = rankFromValue(select?.value);
    button.title = `Rolar ${ROMAN_BY_RANK[rank]} (${rank}d10)`;
  }
}


function updateResourceTrackerVisuals() {
  const read = (id, fallback = 0) => numberFromInput(id, fallback);
  const woundsNormal = read("resource-one-normal", 0);
  const woundsChronic = read("resource-one-chronic", 0);
  const wounds = woundsNormal + woundsChronic;
  const woundsHurt = Math.max(1, read("resource-one-hurt-at", 5));
  const woundsUnconscious = Math.max(1, read("resource-one-unconscious", 10));
  const woundsDead = Math.max(woundsUnconscious + 1, read("resource-one-dead-at", 20));
  const stressNormal = read("resource-two-normal", 0);
  const stressChronic = read("resource-two-chronic", 0);
  const stress = stressNormal + stressChronic;
  const stressStressed = Math.max(1, read("resource-two-stressed-at", 5));
  const stressLosingMind = Math.max(1, read("resource-two-unconscious", 10));
  const stressInsane = Math.max(stressLosingMind + 1, read("resource-two-insane-at", 20));
  const woundsOutput = el("sheet-wounds-current");
  const stressOutput = el("sheet-stress-current");
  const woundsFill = el("sheet-wounds-fill");
  const stressFill = el("sheet-stress-fill");
  if (woundsOutput) woundsOutput.textContent = `${wounds}/${woundsUnconscious}`;
  if (stressOutput) stressOutput.textContent = `${stress}/${stressLosingMind}`;
  if (woundsFill) woundsFill.style.width = `${Math.min(100, wounds / woundsUnconscious * 100)}%`;
  if (stressFill) stressFill.style.width = `${Math.min(100, stress / stressLosingMind * 100)}%`;
  const marker = (id, threshold, max) => {
    const node = el(id);
    if (!node) return;
    const percent = Math.min(100, Math.max(0, threshold / Math.max(1, max) * 100));
    node.style.left = percent >= 100 ? "calc(100% - 2px)" : `${percent}%`;
  };
  marker("sheet-wounds-hurt-marker", woundsHurt, woundsUnconscious);
  marker("sheet-wounds-unconscious-marker", woundsUnconscious, woundsUnconscious);
  marker("sheet-stress-stressed-marker", stressStressed, stressLosingMind);
  marker("sheet-stress-losing-mind-marker", stressLosingMind, stressLosingMind);
  for (const button of form.querySelectorAll("[data-resource-step]")) {
    const isWounds = button.dataset.resourceStep === "wounds";
    const normal = isWounds ? woundsNormal : stressNormal;
    const total = isWounds ? wounds : stress;
    const hardLimit = isWounds ? woundsDead : stressInsane;
    const delta = Number.parseInt(button.dataset.resourceDelta, 10) || 0;
    button.disabled = delta < 0 ? normal <= 0 : total >= hardLimit;
  }
}

function getNameAppearanceFromRoomSettings(roomSettings = {}) {
  const rawPercent = Number(roomSettings.nameSizePercent);
  return {
    nameSizePercent: Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : (roomSettings.nameSize === "small" ? 35 : 0),
    nameAlignment: ["left", "center", "right"].includes(roomSettings.nameAlignment) ? roomSettings.nameAlignment : "center",
    nameColor: /^#[0-9a-f]{6}$/i.test(String(roomSettings.nameColor ?? "")) ? roomSettings.nameColor : "#000000",
    nameFont: ["sans-serif", "Arial", "serif", "Georgia", "Times New Roman", "monospace", "Courier New", "cursive"].includes(roomSettings.nameFont) ? roomSettings.nameFont : "sans-serif",
  };
}

async function openNameAppearanceDialog() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  try {
    await flushPendingSheetSave();
    const items = await OBR.scene.items.getItems([activeTokenId]);
    const token = items[0] ?? activeToken;
    const sheet = readSheet(token);
    const roomMetadata = await OBR.room.getMetadata();
    const roomNameSettings = getNameAppearanceFromRoomSettings(roomMetadata?.[DISPLAY_SETTINGS_KEY] ?? {});
    const appearance = { ...roomNameSettings, ...(sheet.nameAppearance ?? {}) };
    el("token-name-size").value = String(appearance.nameSizePercent);
    el("token-name-size-value").textContent = `${appearance.nameSizePercent}%`;
    el("token-name-alignment").value = appearance.nameAlignment;
    el("token-name-color").value = appearance.nameColor;
    el("token-name-font").value = appearance.nameFont;
    el("token-name-visible").checked = sheet.showTokenName !== false;
    nameAppearanceDialog.showModal();
  } catch (error) {
    console.error("A&A: não foi possível abrir a personalização do nome.", error);
    setNotice("Não foi possível carregar a aparência do nome deste token.", "error");
  }
}

async function saveNameAppearance() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  const saveButton = el("save-name-appearance");
  saveButton.disabled = true;
  try {
    await flushPendingSheetSave();
    const items = await OBR.scene.items.getItems([activeTokenId]);
    const token = items[0] ?? activeToken;
    const sheet = readSheetFromForm(token);
    sheet.nameAppearance = {
      nameSizePercent: Math.max(0, Math.min(100, Number.parseInt(el("token-name-size").value, 10) || 0)),
      nameAlignment: el("token-name-alignment").value,
      nameColor: el("token-name-color").value,
      nameFont: el("token-name-font").value,
    };
    sheet.showTokenName = Boolean(el("token-name-visible").checked);
    await persistSheet(token, normalizeSheet(sheet, token.name));
    const fresh = (await OBR.scene.items.getItems([activeTokenId]))[0] ?? activeToken;
    activeToken = fresh;
    nameAppearanceDialog.close();
    applySheetAccess(readSheet(fresh), "Aparência do nome salva para este token.");
  } catch (error) {
    console.error("A&A: não foi possível salvar a aparência do nome.", error);
    setNotice("Não foi possível salvar a aparência do nome deste token.", "error");
  } finally {
    saveButton.disabled = false;
  }
}

async function resetNameAppearanceToRoom() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  const button = el("reset-name-appearance");
  if (button) button.disabled = true;
  try {
    await flushPendingSheetSave();
    const items = await OBR.scene.items.getItems([activeTokenId]);
    const token = items[0] ?? activeToken;
    const sheet = readSheetFromForm(token);
    delete sheet.nameAppearance;
    sheet.showTokenName = true;
    await persistSheet(token, normalizeSheet(sheet, token.name));
    const fresh = (await OBR.scene.items.getItems([activeTokenId]))[0] ?? activeToken;
    activeToken = fresh;
    nameAppearanceDialog.close();
    applySheetAccess(readSheet(fresh), "Aparência do nome restaurada às configurações da sala.");
  } catch (error) {
    console.error("A&A: não foi possível restaurar o padrão do nome.", error);
    setNotice("Não foi possível restaurar a aparência padrão do nome.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

let resourceSettingsDraft = { woundsChronic: 0, stressChronic: 0 };
function openResourceSettingsDialog() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  el("config-wounds-hurt").value = el("resource-one-hurt-at").value || "5";
  el("config-wounds-unconscious").value = el("resource-one-unconscious").value || "10";
  el("config-wounds-dead").value = el("resource-one-dead-at").value || "20";
  el("config-stress-stressed").value = el("resource-two-stressed-at").value || "5";
  el("config-stress-losing-mind").value = el("resource-two-unconscious").value || "10";
  el("config-stress-insane").value = el("resource-two-insane-at").value || "20";
  resourceSettingsDraft = {
    woundsChronic: Math.max(0, numberFromInput("resource-one-chronic", 0)),
    stressChronic: Math.max(0, numberFromInput("resource-two-chronic", 0)),
  };
  el("config-wounds-chronic-value").textContent = String(resourceSettingsDraft.woundsChronic);
  el("config-stress-chronic-value").textContent = String(resourceSettingsDraft.stressChronic);
  if (!resourceSettingsDialog.open) resourceSettingsDialog.showModal();
}

function stepResource(resourceClass, delta) {
  if (isRestricted()) return;
  const isWounds = resourceClass === "wounds";
  const normalId = isWounds ? "resource-one-normal" : "resource-two-normal";
  const chronicId = isWounds ? "resource-one-chronic" : "resource-two-chronic";
  const finalId = isWounds ? "resource-one-dead-at" : "resource-two-insane-at";
  const currentNormal = Math.max(0, numberFromInput(normalId, 0));
  const chronic = Math.max(0, numberFromInput(chronicId, 0));
  const finalLimit = Math.max(1, numberFromInput(finalId, isWounds ? 20 : 20));
  const nextNormal = delta > 0
    ? Math.min(currentNormal + delta, Math.max(0, finalLimit - chronic))
    : Math.max(0, currentNormal + delta);
  el(normalId).value = String(nextNormal);
  updateResourceTrackerVisuals();
  scheduleAutoSave();
}

async function saveResourceSettings() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  const button = el("save-resource-settings");
  button.disabled = true;
  try {
    const fields = [
      ["resource-one-hurt-at", "config-wounds-hurt"],
      ["resource-one-unconscious", "config-wounds-unconscious"],
      ["resource-one-dead-at", "config-wounds-dead"],
      ["resource-two-stressed-at", "config-stress-stressed"],
      ["resource-two-unconscious", "config-stress-losing-mind"],
      ["resource-two-insane-at", "config-stress-insane"],
    ];
    const thresholds = fields.map(([, dialogId]) => Number.parseInt(el(dialogId).value, 10));
    const invalidIndex = thresholds.findIndex((value) => !Number.isInteger(value) || value < 1 || value > 9999);
    if (invalidIndex >= 0) {
      el(fields[invalidIndex][1]).focus();
      setNotice("Os limites devem ser números inteiros entre 1 e 9999.", "warning");
      return;
    }
    const [woundsHurt, woundsUnconscious, woundsDead, stressStressed, stressLosingMind, stressInsane] = thresholds;
    if (!(woundsHurt < woundsUnconscious && woundsUnconscious < woundsDead && stressStressed < stressLosingMind && stressLosingMind < stressInsane)) {
      setNotice("Cada limite deve ser maior que o anterior: primeiro estágio, segundo estágio e limite final.", "warning");
      return;
    }
    for (let index = 0; index < fields.length; index += 1) el(fields[index][0]).value = String(thresholds[index]);
    const woundsNormal = Math.max(0, numberFromInput("resource-one-normal", 0));
    const stressNormal = Math.max(0, numberFromInput("resource-two-normal", 0));
    el("resource-one-chronic").value = String(Math.min(Math.max(0, resourceSettingsDraft.woundsChronic), Math.max(0, woundsDead - woundsNormal)));
    el("resource-two-chronic").value = String(Math.min(Math.max(0, resourceSettingsDraft.stressChronic), Math.max(0, stressInsane - stressNormal)));
    updateResourceTrackerVisuals();
    resourceSettingsDialog.close();
    scheduleAutoSave();
  } finally {
    button.disabled = false;
  }
}

function writeSheetToForm(sheet) {
  el("character-name").value = sheet.characterName;
  el("character-class").value = sheet.characterClass;
  el("character-organization").value = sheet.organization;
  el("character-occupation").value = sheet.occupation;
  el("character-evolution").value = sheet.evolution;
  el("resource-one-normal").value = sheet.resourceOneNormal;
  el("resource-one-chronic").value = sheet.resourceOneChronic;
  el("resource-one-unconscious").value = sheet.resourceOneUnconscious;
  el("resource-one-hurt-at").value = sheet.resourceOneHurtAt;
  el("resource-one-dead-at").value = sheet.resourceOneDeadAt;
  el("resource-two-normal").value = sheet.resourceTwoNormal;
  el("resource-two-chronic").value = sheet.resourceTwoChronic;
  el("resource-two-unconscious").value = sheet.resourceTwoUnconscious;
  el("resource-two-stressed-at").value = sheet.resourceTwoStressedAt;
  el("resource-two-insane-at").value = sheet.resourceTwoInsaneAt;
  el("character-evasion").value = sheet.evasion;
  el("character-protection").value = sheet.protection;
  el("character-conviction").value = sheet.conviction;
  el("inventory-spaces").value = sheet.inventorySpaces;
  el("character-history").value = sheet.history;
  defenseActiveDraft = Boolean(sheet.defenseActive);
  renderSkills(sheet.skills);
  renderEntryLists(sheet);
  refreshIdentityPreviews();
  updateInventorySpaceTotal();
  updateDefenseDisplay(sheet);
  updateResourceTrackerVisuals();
  refreshMarkdownPreviews();
  applySavedCollapseStates();
  applySavedActiveTab();
}

function clearFormForRestrictedMode() {
  for (const input of form.querySelectorAll("input")) input.value = "";
  for (const textarea of form.querySelectorAll("textarea")) textarea.value = "";
  for (const select of form.querySelectorAll("select")) select.selectedIndex = 0;
  skillsList.replaceChildren();
  defenseActiveDraft = false;
  renderInventory([]);
  updateDefenseDisplay({ skills: [], inventory: [], defenseActive: false });
  powersList.replaceChildren();
  ritualsList.replaceChildren();
  parametersList.replaceChildren();
  traumasList.replaceChildren();
  refreshIdentityPreviews();
  updateInventorySpaceTotal();
  refreshMarkdownPreviews();
}

function isRestricted(sheet = activeSheet) {
  return currentRole !== "GM" && Boolean(sheet?.hideFromPlayers);
}

function setFormEnabled(enabled) {
  for (const field of form.querySelectorAll("input, textarea, select, button")) field.disabled = !enabled;
}

function setInitiativeButtonState(isAdded) {
  initiativeButton.classList.toggle("is-added", isAdded);
  initiativeButton.setAttribute("aria-pressed", String(isAdded));
  initiativeButton.title = isAdded ? "Remover este token da iniciativa" : "Adicionar este token à iniciativa";
}

async function refreshInitiativeButtonState() {
  if (!activeTokenId) {
    setInitiativeButtonState(false);
    return;
  }
  try {
    const state = await readInitiativeState();
    setInitiativeButtonState(state.entries.some((entry) => entry.tokenId === activeTokenId));
  } catch (error) {
    console.warn("A&A: não foi possível verificar o estado da iniciativa.", error);
  }
}

async function toggleActiveTokenInitiative() {
  if (!activeTokenId || !activeToken || initiativeButton.disabled || isRestricted()) return;
  initiativeButton.disabled = true;
  try {
    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    const token = latestItems[0] ?? activeToken;
    const result = await toggleTokenInitiative(token);
    activeToken = token;
    setInitiativeButtonState(result.added);
    setNotice(result.added ? "Personagem adicionado à iniciativa." : "Personagem removido da iniciativa.", "success");
  } catch (error) {
    console.error("A&A: não foi possível alterar a iniciativa.", error);
    setNotice(error?.message || "Não foi possível alterar a iniciativa. Confira se a extensão está aberta dentro de uma sala do Owlbear.", "error");
  } finally {
    initiativeButton.disabled = false;
  }
}

function applySheetAccess(sheet, noticeMessage = "Ficha carregada.") {
  activeSheet = sheet;
  displayedHideFlag = Boolean(sheet.hideFromPlayers);
  const restricted = isRestricted(sheet);
  form.hidden = restricted;
  app.classList.toggle("restricted-mode", restricted);
  visibilityButton.hidden = currentRole !== "GM";
  initiativeButton.hidden = restricted && currentRole !== "GM";
  visibilityButton.textContent = sheet.hideFromPlayers ? "Mostrar" : "Esconder";
  visibilityButton.setAttribute("aria-pressed", String(Boolean(sheet.hideFromPlayers)));
  tokenNameButton.disabled = restricted || !activeTokenId;
  tokenNameButton.title = "Personalizar tamanho, alinhamento, cor, fonte e visibilidade do nome deste token.";
  resetSheetButton.hidden = !activeTokenId || (restricted && currentRole !== "GM");
  resetSheetButton.disabled = !activeTokenId || (restricted && currentRole !== "GM");
  sheetOptionDeleteButton.hidden = currentRole !== "GM";
  initiativeButton.disabled = !activeTokenId;
  void refreshInitiativeButtonState();

  if (restricted) {
    clearFormForRestrictedMode();
    selectedName.textContent = "Acesso restrito";
    setFormEnabled(false);
    setNotice("Informações ocultas pelo mestre.", "warning");
    return;
  }

  writeSheetToForm(sheet);
  selectedName.textContent = sheet.characterName;
  setFormEnabled(true);
  setNotice(noticeMessage, "success");
}

async function persistSheet(token, sheet) {
  await OBR.scene.items.updateItems([token], (items) => {
    for (const item of items) {
      item.name = String(sheet.characterName ?? item.name ?? "Personagem").trim() || "Personagem";
      item.metadata = {
        ...(item.metadata ?? {}),
        [SHEET_KEY]: sheet,
      };
    }
  });

  const freshItems = await OBR.scene.items.getItems([token.id]);
  const freshToken = freshItems[0] ?? token;
  if (activeTokenId === token.id) {
    activeToken = freshToken;
  }
}

async function queueAutoSave() {
  const operation = async () => {
    if (!activeTokenId || !activeToken || isRestricted()) return;
    const tokenId = activeTokenId;
    const latestItems = await OBR.scene.items.getItems([tokenId]);
    const token = latestItems[0] ?? activeToken;
    const latestSheet = readSheet(token);
    if (isRestricted(latestSheet)) {
      activeToken = token;
      applySheetAccess(latestSheet, "Ficha oculta para jogadores.");
      return;
    }
    const sheet = readSheetFromForm(token);
    setNotice("Salvando…");
    await persistSheet(token, sheet);

    if (activeTokenId === tokenId && !isRestricted()) {
      activeSheet = sheet;
      displayedHideFlag = Boolean(sheet.hideFromPlayers);
      const normalizedFields = [
        ["character-evolution", sheet.evolution],
        ["resource-one-normal", sheet.resourceOneNormal],
        ["resource-one-chronic", sheet.resourceOneChronic],
        ["resource-one-unconscious", sheet.resourceOneUnconscious],
        ["resource-one-hurt-at", sheet.resourceOneHurtAt],
        ["resource-one-dead-at", sheet.resourceOneDeadAt],
        ["resource-two-normal", sheet.resourceTwoNormal],
        ["resource-two-chronic", sheet.resourceTwoChronic],
        ["resource-two-unconscious", sheet.resourceTwoUnconscious],
        ["resource-two-stressed-at", sheet.resourceTwoStressedAt],
        ["resource-two-insane-at", sheet.resourceTwoInsaneAt],
        ["character-evasion", sheet.evasion],
        ["character-protection", sheet.protection],
        ["character-conviction", sheet.conviction],
        ["inventory-spaces", sheet.inventorySpaces],
      ];
      for (const [id, value] of normalizedFields) {
        const field = el(id);
        if (document.activeElement !== field && field.value !== String(value)) field.value = String(value);
      }
      setNotice("Salvo.", "success");
    }
  };

  saveQueue = saveQueue.then(operation, operation).catch((error) => {
    console.error(error);
    setNotice("Não foi possível salvar. Abra o console para consultar o erro.", "error");
  });
  return saveQueue;
}

function scheduleAutoSave() {
  if (isRestricted()) return;
  if (!activeTokenId || !activeToken) return;

  selectedName.textContent = el("character-name").value.trim() || activeToken.name || "Personagem";
  setNotice("Alterações pendentes…");
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void queueAutoSave();
  }, 400);
}

function collapseStorageKey() {
  return activeTokenId ? `${COLLAPSE_STORAGE_PREFIX}:${activeTokenId}` : `${COLLAPSE_STORAGE_PREFIX}:default`;
}

function readSavedCollapseStates() {
  try {
    const raw = localStorage.getItem(collapseStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedCollapseStates(states) {
  try {
    localStorage.setItem(collapseStorageKey(), JSON.stringify(states));
  } catch (error) {
    console.warn("A&A: não foi possível memorizar as seções recolhidas neste dispositivo.", error);
  }
}

function applyCollapseButtonState(heading, expanded) {
  const target = el(heading.dataset.collapseTarget);
  if (!target) return;
  target.hidden = !expanded;
  target.classList.remove("summary-collapsed");
  heading.setAttribute("aria-expanded", String(expanded));
  heading.classList.toggle("is-collapsed", !expanded);
  const label = heading.textContent.trim() || "seção";
  heading.setAttribute("aria-label", `${expanded ? "Recolher" : "Expandir"} ${label}`);
}

function applySavedCollapseStates() {
  const states = readSavedCollapseStates();
  for (const heading of form.querySelectorAll("[data-collapse-target]")) {
    const targetId = heading.dataset.collapseTarget;
    if (Object.prototype.hasOwnProperty.call(states, targetId)) {
      applyCollapseButtonState(heading, !Boolean(states[targetId]));
    }
  }
}

function handleCollapseClick(heading) {
  const target = el(heading.dataset.collapseTarget);
  if (!target) return;
  const expanded = heading.getAttribute("aria-expanded") !== "false";
  const nextExpanded = !expanded;
  applyCollapseButtonState(heading, nextExpanded);
  const states = readSavedCollapseStates();
  states[target.id] = !nextExpanded; // Store whether this section is collapsed.
  writeSavedCollapseStates(states);
}

function tabStorageKey() {
  return activeTokenId ? `${TAB_STORAGE_PREFIX}:${activeTokenId}` : `${TAB_STORAGE_PREFIX}:default`;
}

function setActiveTab(tabId, remember = true) {
  const panels = [...form.querySelectorAll("[data-sheet-panel]")];
  const tabButtons = [...form.querySelectorAll("[data-sheet-tab]")];
  if (!panels.some((panel) => panel.id === tabId)) return;
  for (const panel of panels) panel.hidden = panel.id !== tabId;
  for (const button of tabButtons) {
    const active = button.dataset.sheetTab === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  if (remember) {
    try {
      localStorage.setItem(tabStorageKey(), tabId);
    } catch (error) {
      console.warn("A&A: não foi possível memorizar a aba aberta.", error);
    }
  }
}

function applySavedActiveTab() {
  let tabId = "character-tab";
  try {
    tabId = localStorage.getItem(tabStorageKey()) || tabId;
  } catch {
    // The ficha remains usable if local storage is unavailable.
  }
  setActiveTab(tabId, false);
}

function refreshEmptyState(container, emptyText, cardSelector) {
  container.querySelectorAll(".empty-state").forEach((node) => node.remove());
  if (container.querySelector(cardSelector)) return;
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = emptyText;
  container.append(empty);
}

function addInventoryEntry(category = "supply") {
  const entries = readInventoryFromForm();
  const defaultItem = category === "weapon"
    ? { category, name: "", spaces: 0, skill: "armas-simples", damage: "", critical: "", description: "", defletir: 0, aparar: 0 }
    : category === "armor"
      ? { category, name: "", armorKind: "armadura", spaces: 0, evasionBase: 4, protectionBase: 0, evasionBonus: 0, protectionBonus: 0, activeEvasion: 0, activeProtection: 0, equipped: false, description: "" }
      : { category: "supply", name: "", spaces: 1, usesEnabled: false, uses: "", description: "" };
  const item = { id: createEntryId("item"), ...defaultItem };
  entries.push(item);
  renderInventory(entries);
  openEquipmentEditor(item.category, item, { isNew: true });
}

function addAbilityEntry(kind) {
  const container = kind === "power" ? powersList : ritualsList;
  const entries = readAbilitiesFromForm(container);
  entries.push({ id: createEntryId("ability"), name: "", traits: "", description: "" });
  renderAbilityList(container, entries, kind);
  setActiveTab("abilities-tab");
  scheduleAutoSave();
  const newName = container.querySelector("[data-ability-card]:last-of-type [data-ability-field='name']");
  if (newName) setTimeout(() => enterMarkdownEdit(newName), 0);
}

function addProfileEntry(kind) {
  const container = kind === "parameter" ? parametersList : traumasList;
  const entries = readNamedDescriptionEntriesFromForm(container);
  entries.push({ id: createEntryId(kind), name: "", description: "" });
  renderProfileEntryList(container, entries, kind);
  setActiveTab("profile-tab");
  scheduleAutoSave();
  const newName = container.querySelector("[data-profile-card]:last-of-type [data-profile-field='name']");
  if (newName) setTimeout(() => enterMarkdownEdit(newName), 0);
}

function parseTraits(value) {
  return [...new Set(String(value ?? "").split(/[;,]/).map((trait) => trait.trim()).filter(Boolean))]
    .slice(0, 20)
    .map((trait) => trait.slice(0, 80));
}

function removeInventoryCard(card) {
  const category = card.dataset.inventoryCategory || "supply";
  const list = card.closest("[data-equipment-list]");
  card.remove();
  refreshEmptyState(list || inventoryList, category === "weapon" ? "Nenhuma arma." : category === "armor" ? "Nenhuma armadura ou escudo." : "Nenhum suprimento.", "[data-inventory-card]");
  updateInventorySpaceTotal();
  updateDefenseDisplay();
  scheduleAutoSave();
}

function removeAbilityCard(card) {
  const kind = card.dataset.abilityKind;
  const container = kind === "power" ? powersList : ritualsList;
  card.remove();
  refreshEmptyState(container, kind === "power" ? "Nenhum poder cadastrado." : "Nenhum ritual cadastrado.", "[data-ability-card]");
  scheduleAutoSave();
}

function removeProfileCard(card) {
  const kind = card.dataset.profileKind;
  const container = kind === "parameter" ? parametersList : traumasList;
  card.remove();
  refreshEmptyState(container, kind === "parameter" ? "Nenhum parâmetro cadastrado." : "Nenhum trauma cadastrado.", "[data-profile-card]");
  scheduleAutoSave();
}

document.addEventListener("click", (event) => {
  const heading = event.target.closest("[data-collapse-target]");
  if (!heading || heading.disabled) return;
  event.preventDefault();
  handleCollapseClick(heading);
});
document.addEventListener("keydown", (event) => {
  const heading = event.target.closest?.(".collapsible-heading-toggle[data-collapse-target]");
  if (!heading || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  handleCollapseClick(heading);
});

async function togglePlayerVisibility() {
  if (currentRole !== "GM" || !activeTokenId || !activeToken) return;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    void queueAutoSave();
  }
  await saveQueue;

  try {
    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    const token = latestItems[0] ?? activeToken;
    const sheet = isRestricted() ? readSheet(token) : readSheetFromForm(token);
    sheet.hideFromPlayers = !Boolean(token.metadata?.[SHEET_KEY]?.hideFromPlayers);
    await persistSheet(token, sheet);
    const refreshedItems = await OBR.scene.items.getItems([activeTokenId]);
    activeToken = refreshedItems[0] ?? token;
    applySheetAccess(sheet, sheet.hideFromPlayers ? "Ficha oculta para jogadores." : "Ficha visível para jogadores.");
  } catch (error) {
    console.error("A&A: não foi possível alterar a visibilidade da ficha.", error);
    setNotice("Não foi possível alterar a visibilidade da ficha.", "error");
  }
}

async function flushPendingSheetSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    await queueAutoSave();
  } else {
    await saveQueue;
  }
}

async function resetCurrentSheet() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  const targetId = activeTokenId;
  confirmResetSheetButton.disabled = true;
  try {
    await flushPendingSheetSave();
    const items = await OBR.scene.items.getItems([targetId]);
    const token = items[0];
    if (!token) throw new Error("O token selecionado não está mais na cena.");
    await OBR.scene.items.updateItems([token], (updatedItems) => {
      for (const item of updatedItems) {
        item.name = "Personagem";
        const metadata = { ...(item.metadata ?? {}) };
        delete metadata[SHEET_KEY];
        item.metadata = metadata;
      }
    });
    const refreshedItems = await OBR.scene.items.getItems([targetId]);
    const fallbackMetadata = { ...(token.metadata ?? {}) };
    delete fallbackMetadata[SHEET_KEY];
    const refreshedToken = refreshedItems[0] ?? { ...token, name: "Personagem", metadata: fallbackMetadata };
    activeToken = refreshedToken;
    activeSheet = null;
    applySheetAccess(readSheet(refreshedToken), "Ficha limpa. As informações anteriores foram apagadas.");
    resetSheetDialog.close();
    sheetOptionsDialog.close();
  } catch (error) {
    console.error("A&A: não foi possível limpar a ficha.", error);
    setNotice(error?.message || "Não foi possível limpar a ficha.", "error");
  } finally {
    confirmResetSheetButton.disabled = false;
  }
}

async function deleteCurrentToken() {
  if (currentRole !== "GM" || !activeTokenId || !activeToken) return;
  const targetId = activeTokenId;
  confirmDeleteTokenButton.disabled = true;
  try {
    await flushPendingSheetSave();
    await OBR.scene.items.deleteItems([targetId]);
    deleteTokenDialog.close();
    sheetOptionsDialog.close();
    activeTokenId = null;
    activeToken = null;
    activeSheet = null;
    updateSelectedTokenImage(null);
    selectedName.textContent = "Ficha apagada";
    form.hidden = false;
    visibilityButton.hidden = currentRole !== "GM";
    initiativeButton.hidden = false;
    initiativeButton.disabled = true;
    resetSheetButton.hidden = true;
    setFormEnabled(false);
    setNotice("A ficha e o token foram removidos da cena.", "success");
  } catch (error) {
    console.error("A&A: não foi possível apagar a ficha e o token.", error);
    setNotice(error?.message || "Não foi possível apagar a ficha e o token.", "error");
  } finally {
    confirmDeleteTokenButton.disabled = false;
  }
}

function sanitizeFilename(value) {
  const safe = String(value ?? "Personagem").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return safe || "Personagem";
}

async function exportCurrentSheet() {
  if (!activeTokenId || !activeToken || isRestricted()) return;
  try {
    await flushPendingSheetSave();
    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    const token = latestItems[0] ?? activeToken;
    const sheet = readSheetFromForm(token);
    const roomMetadata = await OBR.room.getMetadata();
    const payload = {
      format: "agentes-aparicoes-sheet",
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      exportedFrom: "owlbear-extension",
      displaySettings: roomMetadata?.[DISPLAY_SETTINGS_KEY] ?? {},
      sheet,
    };
    const standaloneHtml = buildStandaloneHtml({
      template: sheetTemplate,
      styles: sheetStyles,
      runtime: standaloneRuntime,
      payload,
    });
    const blob = new Blob([standaloneHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Ficha-${sanitizeFilename(sheet.characterName)}.html`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setNotice("Ficha HTML editável exportada. Abra no navegador, edite e clique em Salvar para gerar a versão que será importada no Owlbear.", "success");
    sheetOptionsDialog.close();
  } catch (error) {
    console.error("A&A: não foi possível exportar a ficha.", error);
    setNotice("Não foi possível exportar a ficha.", "error");
  }
}

async function importCurrentSheet(file) {
  if (!file || !activeTokenId || !activeToken || isRestricted()) return;
  try {
    const candidate = extractSheetFromImport(await file.text(), file.name || "");

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    await saveQueue;
    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    const token = latestItems[0] ?? activeToken;
    const importedSheet = normalizeSheet(candidate, token.name ?? "Personagem");
    await persistSheet(token, importedSheet);
    const refreshedItems = await OBR.scene.items.getItems([activeTokenId]);
    activeToken = refreshedItems[0] ?? token;
    activeSheet = importedSheet;
    applySheetAccess(importedSheet, "Ficha importada com sucesso.");
    sheetOptionsDialog.close();
    setNotice("Ficha importada com sucesso.", "success");
  } catch (error) {
    console.error("A&A: não foi possível importar a ficha.", error);
    setNotice(error instanceof SyntaxError ? "O arquivo não contém JSON válido." : (error?.message || "Não foi possível importar a ficha."), "error");
  } finally {
    importSheetFileInput.value = "";
  }
}

resetSheetButton.addEventListener("click", () => {
  if (!activeTokenId || (isRestricted() && currentRole !== "GM")) return;
  if (typeof sheetOptionsDialog.showModal === "function") sheetOptionsDialog.showModal();
});
closeSheetOptionsButton.addEventListener("click", () => sheetOptionsDialog.close());
sheetOptionsDialog.addEventListener("click", (event) => {
  if (event.target === sheetOptionsDialog) sheetOptionsDialog.close();
});
sheetOptionDeleteButton.addEventListener("click", () => {
  if (currentRole !== "GM") return;
  sheetOptionsDialog.close();
  deleteTokenDialog.showModal();
});
sheetOptionClearButton.addEventListener("click", () => {
  sheetOptionsDialog.close();
  resetSheetDialog.showModal();
});
sheetOptionImportButton.addEventListener("click", () => {
  sheetOptionsDialog.close();
  importSheetFileInput.click();
});
sheetOptionExportButton.addEventListener("click", () => void exportCurrentSheet());
importSheetFileInput.addEventListener("change", () => void importCurrentSheet(importSheetFileInput.files?.[0]));
cancelResetSheetButton.addEventListener("click", () => resetSheetDialog.close());
confirmResetSheetButton.addEventListener("click", () => void resetCurrentSheet());
resetSheetDialog.addEventListener("click", (event) => {
  if (event.target === resetSheetDialog) resetSheetDialog.close();
});
cancelDeleteTokenButton.addEventListener("click", () => deleteTokenDialog.close());
confirmDeleteTokenButton.addEventListener("click", () => void deleteCurrentToken());
deleteTokenDialog.addEventListener("click", (event) => {
  if (event.target === deleteTokenDialog) deleteTokenDialog.close();
});


visibilityButton.addEventListener("click", () => void togglePlayerVisibility());
tokenNameButton.addEventListener("click", () => void openNameAppearanceDialog());
el("defense-active-toggle").addEventListener("click", () => void toggleDefenseActive());
el("equipment-dialog-save").addEventListener("click", saveEquipmentEditor);
el("equipment-armor-kind").addEventListener("change", () => updateArmorEditorLabels());
el("equipment-uses-enabled").addEventListener("change", () => {
  const enabled = el("equipment-uses-enabled").checked;
  el("equipment-uses-field").hidden = !enabled;
  if (enabled && el("equipment-uses").value === "") el("equipment-uses").value = "1";
});
el("equipment-dialog-cancel").addEventListener("click", cancelEquipmentEditor);
el("equipment-dialog-close").addEventListener("click", cancelEquipmentEditor);
equipmentDialog.addEventListener("click", (event) => { if (event.target === equipmentDialog) cancelEquipmentEditor(); });
equipmentDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelEquipmentEditor(); });
initiativeButton.addEventListener("click", () => void toggleActiveTokenInitiative());
el("cancel-name-appearance").addEventListener("click", () => nameAppearanceDialog.close());
el("close-name-appearance")?.addEventListener("click", () => nameAppearanceDialog.close());
el("save-name-appearance").addEventListener("click", () => void saveNameAppearance());
el("reset-name-appearance")?.addEventListener("click", () => void resetNameAppearanceToRoom());
el("token-name-size").addEventListener("input", () => { el("token-name-size-value").textContent = `${el("token-name-size").value}%`; });
nameAppearanceDialog.addEventListener("click", (event) => { if (event.target === nameAppearanceDialog) nameAppearanceDialog.close(); });
el("cancel-resource-settings").addEventListener("click", () => resourceSettingsDialog.close());
el("save-resource-settings").addEventListener("click", () => void saveResourceSettings());
resourceSettingsDialog.addEventListener("click", (event) => { if (event.target === resourceSettingsDialog) resourceSettingsDialog.close(); });
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const openResource = target.closest("[data-open-resource-settings]");
  if (openResource) { event.preventDefault(); openResourceSettingsDialog(); return; }
  const step = target.closest("[data-resource-step]");
  if (step) { event.preventDefault(); stepResource(step.dataset.resourceStep, Number.parseInt(step.dataset.resourceDelta, 10) || 0); return; }
  const chronic = target.closest("[data-config-chronic]");
  if (chronic) {
    event.preventDefault();
    const resourceClass = chronic.dataset.configChronic === "wounds" ? "wounds" : "stress";
    const key = resourceClass === "wounds" ? "woundsChronic" : "stressChronic";
    resourceSettingsDraft[key] = Math.max(0, Math.min(9999, resourceSettingsDraft[key] + (Number.parseInt(chronic.dataset.resourceDelta, 10) || 0)));
    const output = el(resourceClass === "wounds" ? "config-wounds-chronic-value" : "config-stress-chronic-value");
    if (output) output.textContent = String(resourceSettingsDraft[key]);
  }
});

function secureRandomD10() {
  if (!globalThis.crypto?.getRandomValues) return Math.floor(Math.random() * 10) + 1;
  const limit = Math.floor(0x100000000 / 10) * 10;
  const sample = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return (sample[0] % 10) + 1;
}

async function rollSkill(skillId) {
  const skill = ALL_SKILLS.find((entry) => entry.id === skillId);
  if (!skill || !activeToken || isRestricted()) return;

  const select = skillsList.querySelector(`[data-skill-rank="${CSS.escape(skillId)}"]`);
  const count = rankFromValue(select?.value);
  const dice = Array.from({ length: count }, secureRandomD10).sort((a, b) => b - a);
  const characterName = readSheetFromForm(activeToken).characterName;
  let playerName = "Jogador";
  try {
    playerName = (await OBR.player.getName()) || "Jogador";
  } catch {
    // A local fallback keeps the roll usable if the player API is unavailable.
  }

  const roll = {
    type: "skill-roll",
    id: globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
    playerName,
    characterName,
    skillId: skill.id,
    skillName: skill.name,
    tokenId: activeTokenId,
    dice,
    count,
      };

  try {
    await appendRollHistory(roll);
    setNotice(`Rolagem de ${skill.name} enviada para a mesa.`, "success");
  } catch (error) {
    console.error("A&A: não foi possível divulgar a rolagem.", error);
    setNotice(error?.message?.includes("horário de referência")
      ? "A rolagem não foi registrada porque não foi possível consultar o horário de Brasília. Verifique a conexão e tente novamente."
      : "A rolagem foi feita, mas não foi possível exibi-la para todos. Confira a conexão da extensão.", "error");
  }
}

async function useAbility(card) {
  if (!card || !activeToken || isRestricted()) return;
  const kind = card.dataset.abilityKind === "ritual" ? "ritual" : "power";

  try {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    await queueAutoSave();

    const latestItems = await OBR.scene.items.getItems([activeTokenId]);
    activeToken = latestItems[0] ?? activeToken;
    const sheet = readSheetFromForm(activeToken);
    const entries = kind === "power" ? sheet.powers : sheet.rituals;
    const ability = entries.find((entry) => entry.id === card.dataset.abilityId);
    if (!ability || !ability.name.trim()) {
      setNotice(`Preencha o nome ${kind === "power" ? "do poder" : "do ritual"} antes de usar.`, "warning");
      card.querySelector('[data-ability-field="name"]')?.focus();
      return;
    }

    const resolvedInlineRolls = resolveInlineRolls(ability.description, sheet.skills);
    if (resolvedInlineRolls.errors.length) {
      setNotice(resolvedInlineRolls.errors[0], "warning");
      card.querySelector('[data-ability-field="description"]')?.focus();
      return;
    }

    let playerName = "Jogador";
    try {
      playerName = (await OBR.player.getName()) || "Jogador";
    } catch {
      // Keep ability use available if the player-name API is unavailable.
    }

    const payload = {
      type: "ability-use",
      id: createEntryId("ability-use"),
      kind,
      abilityName: ability.name,
      traits: parseTraits(ability.traits),
      description: ability.description,
      inlineRolls: resolvedInlineRolls.rolls,
      playerName,
      characterName: sheet.characterName,
      tokenId: activeTokenId,
          };

    await appendRollHistory(payload);
    setNotice(`${kind === "power" ? "Poder" : "Ritual"} compartilhado com a mesa.`, "success");
  } catch (error) {
    console.error("A&A: não foi possível compartilhar a habilidade.", error);
    setNotice(error?.message?.includes("horário de referência")
      ? "Não foi possível registrar o poder ou ritual porque o horário de Brasília está indisponível. Verifique a conexão e tente novamente."
      : "Não foi possível exibir a habilidade para todos. Confira a conexão da extensão.", "error");
  }
}

function identityFieldValue(control) {
  if (control instanceof HTMLSelectElement) {
    const option = control.selectedOptions[0];
    return option?.value ? option.textContent.trim() : "Não definido";
  }
  const value = String(control.value ?? "").trim();
  if (control.id === "character-evolution") return value ? `${value}%` : "Não definido";
  return value || control.placeholder || "Não definido";
}

function updateIdentityFieldPreview(control) {
  const field = control?.closest(".identity-preview-field");
  const preview = field?.querySelector(".identity-field-preview");
  if (!preview) return;
  const empty = control instanceof HTMLSelectElement ? !control.value : !String(control.value ?? "").trim();
  preview.textContent = identityFieldValue(control);
  preview.classList.toggle("is-placeholder", empty);
}

function refreshIdentityPreviews() {
  for (const control of form.querySelectorAll("[data-identity-preview-field]")) updateIdentityFieldPreview(control);
}

function attachIdentityPreviewFields() {
  const fieldIds = ["character-name", "character-class", "character-organization", "character-occupation", "character-evolution"];
  for (const id of fieldIds) {
    const control = el(id);
    const field = control?.closest(".field");
    if (!control || !field) continue;
    control.dataset.identityPreviewField = "true";
    field.classList.add("identity-preview-field", "is-identity-preview");
    const preview = document.createElement("div");
    preview.className = "identity-field-preview";
    preview.dataset.identityPreviewFor = id;
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.setAttribute("aria-label", `Clique para editar ${field.querySelector(":scope > span")?.textContent || id}`);
    control.insertAdjacentElement("afterend", preview);
    updateIdentityFieldPreview(control);
  }
}

function enterIdentityEdit(control) {
  const field = control?.closest(".identity-preview-field");
  if (!field || control.disabled) return;
  field.classList.remove("is-identity-preview");
  field.classList.add("is-identity-editing");
  control.focus();
  if (control instanceof HTMLInputElement && control.type === "text") {
    try { control.setSelectionRange(control.value.length, control.value.length); } catch { /* not supported by every input type */ }
  }
}

function leaveIdentityEdit(control) {
  const field = control?.closest(".identity-preview-field");
  if (!field || field.classList.contains("is-identity-preview")) return;
  field.classList.remove("is-identity-editing");
  field.classList.add("is-identity-preview");
  updateIdentityFieldPreview(control);
}

function leaveIdentityEditorsOutside(target) {
  for (const field of form.querySelectorAll(".identity-preview-field.is-identity-editing")) {
    if (field.contains(target)) continue;
    const control = field.querySelector("[data-identity-preview-field]");
    if (control) leaveIdentityEdit(control);
  }
}

function updateSelectedTokenImage(token) {
  if (!selectedTokenImage || !selectedTokenFallback) return;
  selectedTokenImage.onerror = null;
  selectedTokenImage.hidden = true;
  selectedTokenFallback.hidden = false;
  selectedTokenImage.parentElement?.classList.remove("has-token-image");
  selectedTokenImage.removeAttribute("src");
  const url = token?.image?.url;
  if (typeof url !== "string" || !url.trim()) return;
  try {
    const parsed = new URL(url, window.location.href);
    if (!["http:", "https:", "blob:"].includes(parsed.protocol)) return;
    selectedTokenImage.onerror = () => {
      selectedTokenImage.hidden = true;
      selectedTokenFallback.hidden = false;
      selectedTokenImage.parentElement?.classList.remove("has-token-image");
      selectedTokenImage.removeAttribute("src");
    };
    selectedTokenImage.src = parsed.href;
    selectedTokenImage.hidden = false;
    selectedTokenFallback.hidden = true;
    selectedTokenImage.parentElement?.classList.add("has-token-image");
  } catch {
    // Keep the A&A mark as a fallback when the token image has no valid URL.
  }
}

skillsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-roll-skill]");
  if (!button || button.disabled) return;
  void rollSkill(button.dataset.rollSkill);
});

form.addEventListener("click", (event) => {
  const target = event.target;
  const identityPreview = target.closest("[data-identity-preview-for]");
  if (identityPreview) {
    event.preventDefault();
    const control = el(identityPreview.dataset.identityPreviewFor);
    if (control && !control.disabled) enterIdentityEdit(control);
    return;
  }

  const formattedPreview = target.closest('.formatted-editor[data-replace-mode="true"] .markdown-preview');
  if (formattedPreview) {
    event.preventDefault();
    const wrapper = formattedPreview.closest(".formatted-editor");
    const editor = wrapper?.querySelector("input, textarea");
    if (editor && !editor.disabled) enterMarkdownEdit(editor);
    return;
  }

  const tabButton = target.closest("[data-sheet-tab]");
  if (tabButton && !tabButton.disabled) {
    event.preventDefault();
    setActiveTab(tabButton.dataset.sheetTab);
    return;
  }

  const addEquipment = target.closest("[data-add-equipment]");
  if (addEquipment && !addEquipment.disabled) {
    event.preventDefault();
    addInventoryEntry(addEquipment.dataset.addEquipment);
    return;
  }

  const equipmentAction = target.closest("[data-equipment-action]");
  if (equipmentAction && !equipmentAction.disabled) {
    event.preventDefault();
    const card = equipmentAction.closest("[data-inventory-card]");
    const action = equipmentAction.dataset.equipmentAction;
    if (action === "edit" && card) openEquipmentEditor(card.dataset.inventoryCategory, card._equipmentData);
    else if (action === "attack" && card) openWeaponAttack(card._equipmentData);
    else if (action === "toggle-equipped" && card) toggleEquipmentEquipped(card);
    else if (action === "reaction" && card) toggleWeaponReaction(card);
    else if (action === "uses-down" && card) adjustSupplyUses(card, -1);
    else if (action === "uses-up" && card) adjustSupplyUses(card, 1);
    return;
  }

  if (target.closest("#inventory-spaces-used")) {
    event.preventDefault();
    openInventorySpacesEditor();
    return;
  }

  if (target.closest("#add-inventory-item")) {
    event.preventDefault();
    addInventoryEntry();
    return;
  }
  if (target.closest("#add-power")) {
    event.preventDefault();
    addAbilityEntry("power");
    return;
  }
  if (target.closest("#add-ritual")) {
    event.preventDefault();
    addAbilityEntry("ritual");
    return;
  }
  if (target.closest("#add-parameter")) {
    event.preventDefault();
    addProfileEntry("parameter");
    return;
  }
  if (target.closest("#add-trauma")) {
    event.preventDefault();
    addProfileEntry("trauma");
    return;
  }

  const removeProfile = target.closest("[data-remove-profile-entry]");
  if (removeProfile && !removeProfile.disabled) {
    event.preventDefault();
    const card = removeProfile.closest("[data-profile-card]");
    if (card) removeProfileCard(card);
    return;
  }
  const removeInventory = target.closest("[data-remove-inventory]");
  if (removeInventory && !removeInventory.disabled) {
    event.preventDefault();
    const card = removeInventory.closest("[data-inventory-card]");
    if (card && window.confirm(`Excluir o item "${card._equipmentData?.name || "sem nome"}"?`)) removeInventoryCard(card);
    return;
  }
  const removeAbility = target.closest("[data-remove-ability]");
  if (removeAbility && !removeAbility.disabled) {
    event.preventDefault();
    const card = removeAbility.closest("[data-ability-card]");
    if (card) removeAbilityCard(card);
    return;
  }
  const useButton = target.closest("[data-use-ability]");
  if (useButton && !useButton.disabled) {
    event.preventDefault();
    const card = useButton.closest("[data-ability-card]");
    void useAbility(card);
  }
});

form.addEventListener("input", (event) => {
  if (event.target.matches("#inventory-spaces-editor")) return;
  if (event.target.matches("input, textarea")) {
    if (event.target.matches("[data-markdown-editor]") && event.target.dataset.formatReplace !== "true") {
      scheduleMarkdownPreview(event.target);
    }
    if (event.target.matches('[data-inventory-field="spaces"], #inventory-spaces')) {
      updateInventorySpaceTotal();
    }
    if (event.target.matches("[data-skill-rank]")) updateDefenseDisplay();
    if (event.target.matches("[data-identity-preview-field]")) updateIdentityFieldPreview(event.target);
    scheduleAutoSave();
  }
});
form.addEventListener("change", (event) => {
  if (event.target.matches("select")) {
    if (event.target.matches("#equipment-armor-kind")) updateArmorEditorLabels();
    if (event.target.matches("[data-identity-preview-field]")) updateIdentityFieldPreview(event.target);
    if (event.target.matches("[data-skill-rank]")) updateDefenseDisplay();
    scheduleAutoSave();
  }
});
form.addEventListener("focusout", (event) => {
  const editor = event.target;
  if (editor.matches("#inventory-spaces-editor")) {
    setTimeout(() => {
      if (document.activeElement !== editor) closeInventorySpacesEditor({ save: true });
    }, 0);
    return;
  }
  if (editor.matches("[data-identity-preview-field]")) {
    setTimeout(() => {
      const field = editor.closest(".identity-preview-field");
      if (field && !field.contains(document.activeElement)) leaveIdentityEdit(editor);
    }, 0);
  }
  if (!editor.matches('[data-format-replace="true"]')) return;
  setTimeout(() => {
    const wrapper = editor.closest('.formatted-editor[data-replace-mode="true"]');
    if (wrapper && !wrapper.contains(document.activeElement)) leaveMarkdownEdit(editor);
  }, 0);
});

// Clicking anywhere outside the active editor commits and returns to the
// formatted view, including clicks on non-focusable space or other controls.
document.addEventListener("click", (event) => {
  leaveMarkdownEditorsOutside(event.target);
  leaveIdentityEditorsOutside(event.target);
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const inventoryLimitEditor = el("inventory-spaces-editor");
  if (!inventoryLimitEditor.hidden && !target.closest(".inventory-spaces-control")) {
    closeInventorySpacesEditor({ save: true });
  }

  const itemSpacesEditor = inventoryList.querySelector(".inventory-item-spaces:not([hidden])");
  if (itemSpacesEditor && !target.closest(".inventory-number-field")) {
    itemSpacesEditor.blur();
  }
});
window.addEventListener("blur", () => {
  for (const wrapper of form.querySelectorAll('.formatted-editor[data-replace-mode="true"]:not(.is-preview-mode)')) {
    const editor = wrapper.querySelector("input, textarea");
    if (editor) leaveMarkdownEdit(editor);
  }
});

async function refreshTokenAccessIfChanged() {
  if (!activeTokenId) return;
  lastAccessRefresh = lastAccessRefresh.then(async () => {
    const items = await OBR.scene.items.getItems([activeTokenId]);
    const freshToken = items[0];
    if (!freshToken) return;
    activeToken = freshToken;
    const savedHide = Boolean(freshToken.metadata?.[SHEET_KEY]?.hideFromPlayers);
    if (savedHide !== displayedHideFlag) {
      const freshSheet = readSheet(freshToken);
      applySheetAccess(freshSheet, freshSheet.hideFromPlayers ? "Ficha oculta para jogadores." : "Ficha visível para jogadores.");
    }
  }).catch((error) => console.error("A&A: falha ao atualizar permissões da ficha.", error));
  return lastAccessRefresh;
}

async function initializeSheet() {
  if (!sdkReady) return;
  try {
    currentRole = await OBR.player.getRole();
    const selection = await OBR.player.getSelection();
    if (!selection?.length || selection.length !== 1) {
      activeTokenId = null;
      activeToken = null;
      activeSheet = null;
      updateSelectedTokenImage(null);
      resetSheetButton.hidden = true;
      selectedName.textContent = "Selecione um token";
      form.hidden = false;
      visibilityButton.hidden = currentRole !== "GM";
      initiativeButton.hidden = false;
      initiativeButton.disabled = true;
      setInitiativeButtonState(false);
      setFormEnabled(false);
      setNotice("Abra esta ficha pelo menu de um único token.", "warning");
      return;
    }

    const items = await OBR.scene.items.getItems(selection);
    const token = items.find((item) => item.layer === "CHARACTER" && item.type === "IMAGE");
    if (!token) {
      activeTokenId = null;
      activeToken = null;
      activeSheet = null;
      updateSelectedTokenImage(null);
      resetSheetButton.hidden = true;
      selectedName.textContent = "Item não compatível";
      form.hidden = false;
      visibilityButton.hidden = currentRole !== "GM";
      initiativeButton.hidden = false;
      initiativeButton.disabled = true;
      setInitiativeButtonState(false);
      setFormEnabled(false);
      setNotice("Selecione uma imagem na camada Personagens.", "warning");
      return;
    }

    activeTokenId = token.id;
    activeToken = token;
    updateSelectedTokenImage(token);
    const sheet = readSheet(token);
    applySheetAccess(sheet, `Ficha de “${sheet.characterName}” carregada.`);

    // A player whose view is restricted must not migrate or write any data.
    if (!isRestricted(sheet)) await persistSheet(token, sheet);

    if (!unsubscribeItems) {
      unsubscribeItems = OBR.scene.items.onChange(() => {
        void refreshTokenAccessIfChanged();
      });
    }
    if (!unsubscribeInitiativeMetadata) {
      unsubscribeInitiativeMetadata = OBR.room.onMetadataChange(() => {
        void refreshInitiativeButtonState();
      });
    }
  } catch (error) {
    console.error(error);
    form.hidden = false;
    setFormEnabled(false);
    setNotice("Não foi possível carregar a ficha. Confira se a extensão está aberta dentro de uma sala do Owlbear.", "error");
  }
}

form.addEventListener("keydown", (event) => {
  const editor = event.target.closest?.("#inventory-spaces-editor");
  if (!editor) return;
  if (event.key === "Enter") {
    event.preventDefault();
    closeInventorySpacesEditor({ save: true, restoreFocus: true });
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeInventorySpacesEditor({ save: false, restoreFocus: true });
  }
});

form.addEventListener("submit", (event) => event.preventDefault());
attachIdentityPreviewFields();
attachStaticMarkdownEditors();
themeController.apply();
setFormEnabled(false);

OBR.onReady(() => {
  themeController.connect(OBR);
  sdkReady = true;
  app.classList.remove("not-ready");
  void initializeSheet();
});
