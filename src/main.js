import OBR from "@owlbear-rodeo/sdk";
import "./style.css";
import { activeDieValue, calculateTestResult } from "./diceRules.js";
import { renderFormattedMarkdown, renderInlineMarkdown } from "./markdown.js";
import { createThemeController, THEME_STORAGE_KEY, THEME_CUSTOMIZATION_KEY } from "./theme.js";
import {
  INITIATIVE_KEY,
  normalizeInitiativeState,
  readInitiativeState,
  sortInitiativeEntries,
  writeInitiativeState,
} from "./initiative.js";
import { MAX_DIE_RESULTS, MAX_ROLL_HISTORY, normalizeRollHistory, ROLL_HISTORY_KEY, appendRollHistory, clearRollHistory, rerollLogDie, toggleLogReaction, updateRollHistoryEntry } from "./rollHistory.js";
import { renderInlineRolls, resolveInlineRolls, updateInlineRollTestResult } from "./inlineRolls.js";

const byId = (id) => document.getElementById(id);
const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
const SHEET_KEY = `${EXTENSION_ID}/sheet`;
const DISPLAY_SETTINGS_KEY = `${EXTENSION_ID}/display-settings`;
const SETTINGS_COLLAPSE_STORAGE_KEY = `${EXTENSION_ID}/settings-collapsed-sections`;
const SETTINGS_COLLAPSE_LABELS = Object.freeze({
  "token-appearance-content": "Aparência dos Tokens",
  "initiative-details-content": "Iniciativa Detalhada",
  "theme-settings-content": "Aparência Individual",
});
const themeController = createThemeController();
const initiativeList = byId("initiative-list");
const initiativeEmpty = byId("initiative-empty");
const initiativeDetailsToggle = byId("toggle-initiative-details");
const chatUnreadCount = byId("chat-unread-count");
const initiativeNotice = byId("initiative-notice");
const roundButton = byId("round-button");
const roundActions = byId("round-actions");
const rollHistoryList = byId("roll-history-list");
const rollHistoryEmpty = byId("roll-history-empty");
const chatComposer = byId("chat-composer");
const chatInput = byId("chat-input");
const chatSendButton = byId("chat-send");
const logRollButtons = byId("log-roll-buttons");
const clearLogButton = byId("clear-log-button");
const clearLogDialog = byId("clear-log-dialog");
const confirmClearLogButton = byId("confirm-clear-log");
const cancelClearLogButton = byId("cancel-clear-log");
const rerollDieDialog = byId("reroll-die-dialog");
const rerollDieDescription = byId("reroll-die-description");
const confirmRerollDieButton = byId("confirm-reroll-die");
const chooseRerollValueButton = byId("choose-reroll-value");
const rerollDieValueInput = byId("reroll-die-value");
const cancelRerollDieButton = byId("cancel-reroll-die");
let sceneItemsUnsubscribe = null;
let sceneReadyUnsubscribe = null;
let roomMetadataUnsubscribe = null;
let actionOpenUnsubscribe = null;
let renderSequence = 0;
let rollHistoryRenderSequence = 0;
let writeQueue = Promise.resolve();
let currentRole = "PLAYER";
let currentPlayerKey = "";
let pendingReroll = null;
let showDetailedInitiative = false;
let actionPopoverOpen = true;
let chatHistoryInitialized = false;
let lastRollHistory = [];
let unreadMessageCount = 0;
let originalActionIcon = new URL("icon.svg", window.location.href).href;
const CHAT_SEEN_STORAGE_PREFIX = `${EXTENSION_ID}/chat-seen-v1`;
const DETAILED_INITIATIVE_STORAGE_KEY = `${EXTENSION_ID}/detailed-initiative-enabled`;
const INITIATIVE_SKILLS = Object.freeze([
  { id: "agilidade", name: "Agilidade" }, { id: "fortitude", name: "Fortitude" }, { id: "vontade", name: "Vontade" },
  { id: "armaduras", name: "Armaduras" }, { id: "armas-de-fogo", name: "Armas de Fogo" }, { id: "armas-simples", name: "Armas Simples" },
  { id: "acrobacia", name: "Acrobacia" }, { id: "artes", name: "Artes" }, { id: "atletismo", name: "Atletismo" },
  { id: "ciencias", name: "Ciências" }, { id: "cultura", name: "Cultura" }, { id: "destreza", name: "Destreza" },
  { id: "diplomacia", name: "Diplomacia" }, { id: "empatia", name: "Empatia" }, { id: "enganacao", name: "Enganação" },
  { id: "forca", name: "Força" }, { id: "furtividade", name: "Furtividade" }, { id: "intimidacao", name: "Intimidação" },
  { id: "ocultismo", name: "Ocultismo" }, { id: "percepcao", name: "Percepção" }, { id: "tatica", name: "Tática" }, { id: "tecnologia", name: "Tecnologia" },
]);
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  // Saturated filled colors over lighter, translucent tracks.
  woundsColor: "#bf4652",
  stressColor: "#347fbd",
  woundsBackgroundColor: "#d9878d",
  stressBackgroundColor: "#87b3e2",
  barSize: "small",
  barAlignment: "center",
  barTextColor: "#ffffff",
  barFont: "sans-serif",
  defenseSize: "small",
  defenseAlignment: "center",
  defenseColor: "#ffffff",
  defenseFont: "sans-serif",
  evasionBackgroundColor: "#7198c8",
  protectionBackgroundColor: "#70a783",
  convictionBackgroundColor: "#ac913e",
  initiativeShowWounds: true,
  initiativeWoundsMode: "bar",
  initiativeShowStress: true,
  initiativeStressMode: "bar",
  initiativeShowEvasion: true,
  initiativeShowProtection: true,
  initiativeShowConviction: true,
  initiativePassiveSkills: [],
  nameSize: 0,
  nameAlignment: "center",
  nameColor: "#000000",
  nameFont: "serif",
  barPlacement: "bottom",
});
let displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
let settingsWriteQueue = Promise.resolve();
let editingInitiativeSkillId = null;
let editingInitiativeSkillColor = null;

function hashPlayerKey(value) {
  const source = String(value ?? "");
  if (!source) return "";
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function setNotice(message, type = "info") {
  initiativeNotice.textContent = message;
  initiativeNotice.dataset.type = type;
}


async function adaptActionPopoverForSmallScreens() {
  const screenWidth = Number(window.screen?.availWidth) || 0;
  const screenHeight = Number(window.screen?.availHeight) || 0;
  if (screenWidth <= 0 || screenHeight <= 0) return;
  if (screenWidth > 600 && screenHeight > 600) return;

  const width = screenWidth > 0 ? Math.max(260, Math.min(390, screenWidth - 24)) : 330;
  const height = screenHeight > 0 ? Math.max(300, Math.min(620, screenHeight - 120)) : 480;
  await Promise.all([OBR.action.setWidth(width), OBR.action.setHeight(height)]);
}

function setMainTab(tabId) {
  for (const panel of document.querySelectorAll("[data-main-panel], .main-tab-panel")) {
    panel.hidden = panel.id !== tabId;
  }
  for (const tab of document.querySelectorAll("[data-main-tab]")) {
    const active = tab.dataset.mainTab === tabId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  if (chatHistoryInitialized) {
    if (tabId === "roll-history-view" && actionPopoverOpen) markChatHistoryRead(lastRollHistory);
    else updateChatUnreadIndicator(lastRollHistory);
  }
}

function chatSeenStorageKey() {
  return `${CHAT_SEEN_STORAGE_PREFIX}/${currentPlayerKey || "anonymous"}`;
}

function readSeenChatIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(chatSeenStorageKey()) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function saveSeenChatIds(ids) {
  try {
    localStorage.setItem(chatSeenStorageKey(), JSON.stringify([...ids].slice(-120)));
  } catch (error) {
    console.debug("A&A: não foi possível salvar as mensagens lidas localmente.", error);
  }
}

let lastUnreadIconState = null;
async function getDefaultActionIcon() {
  try {
    const response = await fetch(new URL("manifest.json", window.location.href), { cache: "no-store" });
    if (response.ok) {
      const manifest = await response.json();
      if (typeof manifest?.action?.icon === "string" && manifest.action.icon) {
        return new URL(manifest.action.icon, window.location.href).href;
      }
    }
  } catch (error) {
    console.debug("A&A: não foi possível ler o ícone original do manifesto.", error);
  }
  return new URL("icon.svg", window.location.href).href;
}
function renderUnreadIndicator(count) {
  unreadMessageCount = Math.max(0, Number(count) || 0);
  if (chatUnreadCount) {
    chatUnreadCount.hidden = unreadMessageCount <= 0;
    chatUnreadCount.textContent = unreadMessageCount > 99 ? "99+" : String(unreadMessageCount);
    chatUnreadCount.setAttribute("aria-label", `${unreadMessageCount} mensagens não lidas`);
  }
  const hasUnread = unreadMessageCount > 0;
  if (lastUnreadIconState === hasUnread) return;
  lastUnreadIconState = hasUnread;
  const iconUrl = hasUnread
    ? new URL("icon-unread.svg", window.location.href).href
    : (originalActionIcon || new URL("icon.png", window.location.href).href);
  void OBR.action.setIcon(iconUrl).catch((error) => {
    lastUnreadIconState = null;
    console.debug("A&A: não foi possível atualizar o indicador no ícone da extensão.", error);
  });
}

function markChatHistoryRead(history = lastRollHistory) {
  const seen = readSeenChatIds();
  for (const entry of history) {
    if (typeof entry?.id === "string") seen.add(entry.id);
  }
  saveSeenChatIds(seen);
  chatHistoryInitialized = true;
  renderUnreadIndicator(0);
}

function updateChatUnreadIndicator(history = lastRollHistory) {
  // On first use, treat the already-existing CHAT history as read. This avoids
  // presenting an entire old session as new after installing/updating the extension.
  if (!chatHistoryInitialized) {
    let stored = null;
    try { stored = localStorage.getItem(chatSeenStorageKey()); } catch { /* Storage is optional. */ }
    if (stored === null) {
      markChatHistoryRead(history);
      return;
    }
    chatHistoryInitialized = true;
  }

  const chatPanel = byId("roll-history-view");
  if (actionPopoverOpen && chatPanel && !chatPanel.hidden) {
    markChatHistoryRead(history);
    return;
  }
  const seen = readSeenChatIds();
  const unseen = history.reduce((count, entry) => count + (entry?.id && !seen.has(entry.id) ? 1 : 0), 0);
  renderUnreadIndicator(unseen);
}

function readSettingsCollapseStates() {
  try {
    const raw = localStorage.getItem(SETTINGS_COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function applySettingsCollapseState(button, expanded) {
  const target = byId(button.dataset.collapseTarget);
  if (!target) return;
  const sectionName = SETTINGS_COLLAPSE_LABELS[target.id] || "seção";
  target.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  button.textContent = expanded ? "−" : "+";
  button.setAttribute("aria-label", `${expanded ? "Esconder" : "Mostrar"} ${sectionName}`);
}

function initializeSettingsCollapseStates() {
  const saved = readSettingsCollapseStates();
  for (const button of document.querySelectorAll("#settings-view [data-collapse-target]")) {
    const targetId = button.dataset.collapseTarget;
    const expanded = Object.prototype.hasOwnProperty.call(saved, targetId)
      ? !Boolean(saved[targetId])
      : button.getAttribute("aria-expanded") !== "false";
    applySettingsCollapseState(button, expanded);
  }
}

function toggleSettingsCollapse(button) {
  const targetId = button.dataset.collapseTarget;
  const target = byId(targetId);
  if (!target) return;
  const expanded = button.getAttribute("aria-expanded") !== "false";
  const nextExpanded = !expanded;
  applySettingsCollapseState(button, nextExpanded);
  const states = readSettingsCollapseStates();
  states[targetId] = !nextExpanded;
  try {
    localStorage.setItem(SETTINGS_COLLAPSE_STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    console.warn("A&A: não foi possível salvar o estado das seções de configuração.", error);
  }
}

initializeSettingsCollapseStates();

function normalizeInitiativeSkillColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : null;
}

function normalizeConfiguredInitiativeSkills(rawSkills) {
  if (!Array.isArray(rawSkills)) return [];
  const knownIds = new Set(INITIATIVE_SKILLS.map((skill) => skill.id));
  const seen = new Set();
  const configured = [];
  for (const raw of rawSkills) {
    const id = typeof raw === "string" ? raw : String(raw?.id ?? "");
    if (!knownIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    // Legacy string entries represented passive values, so preserve their old behavior.
    const entry = { id, passive: typeof raw === "string" ? true : raw?.passive !== false };
    const color = normalizeInitiativeSkillColor(raw?.color);
    if (color) entry.color = color;
    configured.push(entry);
  }
  return configured.slice(0, INITIATIVE_SKILLS.length);
}

function normalizeDisplaySettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
  const allowedFonts = ["sans-serif", "Arial", "serif", "Georgia", "Times New Roman", "monospace", "Courier New", "cursive"];
  const normalizeFont = (value) => {
    const legacy = { "Roboto, sans-serif": "sans-serif", "Inter, sans-serif": "sans-serif", "Arial, sans-serif": "Arial", "Georgia, serif": "Georgia" };
    const candidate = legacy[String(value ?? "")] ?? String(value ?? "");
    return allowedFonts.includes(candidate) ? candidate : "sans-serif";
  };
  return {
    woundsColor: validColor(source.woundsColor, DEFAULT_DISPLAY_SETTINGS.woundsColor),
    stressColor: validColor(source.stressColor, DEFAULT_DISPLAY_SETTINGS.stressColor),
    woundsBackgroundColor: validColor(source.woundsBackgroundColor, DEFAULT_DISPLAY_SETTINGS.woundsBackgroundColor),
    stressBackgroundColor: validColor(source.stressBackgroundColor, DEFAULT_DISPLAY_SETTINGS.stressBackgroundColor),
    barSize: source.barSize === "large" ? "large" : "small",
    barAlignment: ["left", "center", "right"].includes(source.barAlignment) ? source.barAlignment : DEFAULT_DISPLAY_SETTINGS.barAlignment,
    barTextColor: validColor(source.barTextColor, DEFAULT_DISPLAY_SETTINGS.barTextColor),
    barFont: normalizeFont(source.barFont),
    defenseSize: source.defenseSize === "large" ? "large" : "small",
    defenseAlignment: ["left", "center", "right"].includes(source.defenseAlignment) ? source.defenseAlignment : DEFAULT_DISPLAY_SETTINGS.defenseAlignment,
    defenseColor: validColor(source.defenseColor, DEFAULT_DISPLAY_SETTINGS.defenseColor),
    defenseFont: normalizeFont(source.defenseFont),
    evasionBackgroundColor: validColor(source.evasionBackgroundColor, DEFAULT_DISPLAY_SETTINGS.evasionBackgroundColor),
    protectionBackgroundColor: validColor(source.protectionBackgroundColor, DEFAULT_DISPLAY_SETTINGS.protectionBackgroundColor),
    convictionBackgroundColor: validColor(source.convictionBackgroundColor, DEFAULT_DISPLAY_SETTINGS.convictionBackgroundColor),
    initiativeShowWounds: true,
    initiativeWoundsMode: "bar",
    initiativeShowStress: true,
    initiativeStressMode: "bar",
    initiativeShowEvasion: source.initiativeShowEvasion !== false && source.initiativeShowDefenses !== false,
    initiativeShowProtection: source.initiativeShowProtection !== false && source.initiativeShowDefenses !== false,
    initiativeShowConviction: source.initiativeShowConviction !== false && source.initiativeShowDefenses !== false,
    initiativePassiveSkills: normalizeConfiguredInitiativeSkills(source.initiativePassiveSkills),
    nameSize: Number.isFinite(Number(source.nameSize)) ? Math.max(0, Math.min(100, Math.round(Number(source.nameSize)))) : 0,
    nameAlignment: ["left", "center", "right"].includes(source.nameAlignment) ? source.nameAlignment : DEFAULT_DISPLAY_SETTINGS.nameAlignment,
    nameColor: validColor(source.nameColor, DEFAULT_DISPLAY_SETTINGS.nameColor),
    nameFont: normalizeFont(source.nameFont),
    barPlacement: source.barPlacement === "top" ? "top" : "bottom",
  };
}

function setSettingsNotice(message, type = "info") {
  const node = byId("settings-notice");
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
}

const THEME_COLOR_CONTROLS = Object.freeze({
  background: "theme-color-background",
  surface: "theme-color-surface",
  field: "theme-color-field",
  text: "theme-color-text",
  muted: "theme-color-muted",
  accent: "theme-color-accent",
  accentText: "theme-color-accent-text",
  heading: "theme-color-heading",
  border: "theme-color-border",
  traitBackground: "theme-color-traits",
  traitText: "theme-color-trait-text",
  interfaceHighlight: "theme-color-interface-highlight",
});

function renderThemeControls() {
  const choice = themeController.getChoice();
  const themeSelect = byId("interface-theme");
  if (themeSelect) themeSelect.value = choice;
  const customizationPanel = byId("custom-theme-controls");
  if (customizationPanel) customizationPanel.hidden = choice !== "custom";

  const settings = themeController.getCustomization();
  for (const [key, id] of Object.entries(THEME_COLOR_CONTROLS)) {
    const input = byId(id);
    if (input) input.value = settings[key];
  }
  const transparency = byId("theme-transparency");
  const transparencyValue = byId("theme-transparency-value");
  if (transparency) transparency.value = String(settings.transparency);
  if (transparencyValue) transparencyValue.textContent = `${settings.transparency}%`;
  const radius = byId("theme-radius");
  const radiusValue = byId("theme-radius-value");
  if (radius) radius.value = String(settings.radius);
  if (radiusValue) radiusValue.textContent = `${settings.radius} px`;
}

function applyLocalTheme(theme) {
  themeController.setChoice(theme);
  renderThemeControls();
}

function initializeLocalTheme() {
  themeController.apply();
  renderThemeControls();
}

function openInitiativeSkillDialog(skillId = null) {
  if (currentRole !== "GM") return;
  const dialog = byId("initiative-skill-dialog");
  const select = byId("initiative-skill-choice");
  const passive = byId("initiative-skill-passive");
  const title = byId("initiative-skill-dialog-title");
  const saveButton = byId("save-initiative-skill");
  const deleteButton = byId("delete-initiative-skill");
  const colorButton = byId("initiative-skill-color-button");
  const colorInput = byId("initiative-skill-color-input");
  if (!dialog || !select || !passive || !title || !saveButton) return;

  const existing = displaySettings.initiativePassiveSkills.find((skill) => skill.id === skillId);
  editingInitiativeSkillId = existing?.id ?? null;
  editingInitiativeSkillColor = normalizeInitiativeSkillColor(existing?.color);
  if (colorInput) colorInput.value = editingInitiativeSkillColor || "#a72129";
  if (colorButton) {
    colorButton.style.backgroundColor = editingInitiativeSkillColor || "var(--aa-custom-border, #424242)";
    colorButton.setAttribute("aria-label", editingInitiativeSkillColor ? `Cor personalizada ${editingInitiativeSkillColor}` : "Escolher cor personalizada para a perícia");
    colorButton.title = editingInitiativeSkillColor ? `Cor personalizada: ${editingInitiativeSkillColor}` : "Escolher cor personalizada";
  }
  const taken = new Set(displaySettings.initiativePassiveSkills.map((skill) => skill.id).filter((id) => id !== skillId));
  select.replaceChildren();
  for (const skill of INITIATIVE_SKILLS) {
    if (taken.has(skill.id)) continue;
    const option = document.createElement("option");
    option.value = skill.id;
    option.textContent = skill.name;
    select.append(option);
  }
  if (skillId && ![...select.options].some((option) => option.value === skillId)) {
    const option = document.createElement("option");
    option.value = skillId;
    option.textContent = INITIATIVE_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId;
    select.append(option);
  }
  if (skillId) select.value = skillId;
  passive.checked = existing?.passive !== false;
  title.textContent = existing ? "Editar perícia" : "Adicionar perícia";
  saveButton.textContent = existing ? "Salvar" : "Adicionar";
  saveButton.disabled = select.options.length === 0;
  if (deleteButton) deleteButton.hidden = !existing;
  if (!dialog.open) dialog.showModal();
}

byId("initiative-skill-color-button")?.addEventListener("click", () => byId("initiative-skill-color-input")?.click());
byId("initiative-skill-color-input")?.addEventListener("input", (event) => {
  const color = normalizeInitiativeSkillColor(event.target.value);
  if (!color) return;
  editingInitiativeSkillColor = color;
  const button = byId("initiative-skill-color-button");
  if (button) {
    button.style.backgroundColor = color;
    button.setAttribute("aria-label", `Cor personalizada ${color}`);
    button.title = `Cor personalizada: ${color}`;
  }
});
byId("cancel-initiative-skill")?.addEventListener("click", () => byId("initiative-skill-dialog")?.close());
byId("initiative-skill-dialog")?.addEventListener("click", (event) => {
  if (event.target === byId("initiative-skill-dialog")) byId("initiative-skill-dialog").close();
});
byId("initiative-skill-dialog")?.addEventListener("close", () => { editingInitiativeSkillId = null; editingInitiativeSkillColor = null; });
byId("save-initiative-skill")?.addEventListener("click", () => {
  if (currentRole !== "GM") return;
  const skillId = String(byId("initiative-skill-choice")?.value ?? "");
  const definition = INITIATIVE_SKILLS.find((skill) => skill.id === skillId);
  if (!definition) return;
  const configured = displaySettings.initiativePassiveSkills.filter((skill) => skill.id !== editingInitiativeSkillId && skill.id !== skillId);
  const entry = { id: skillId, passive: Boolean(byId("initiative-skill-passive")?.checked) };
  if (editingInitiativeSkillColor) entry.color = editingInitiativeSkillColor;
  configured.push(entry);
  displaySettings = normalizeDisplaySettings({ ...displaySettings, initiativePassiveSkills: configured });
  byId("initiative-skill-dialog")?.close();
  void saveDisplaySettings();
});
byId("delete-initiative-skill")?.addEventListener("click", () => {
  if (currentRole !== "GM" || !editingInitiativeSkillId) return;
  displaySettings = normalizeDisplaySettings({
    ...displaySettings,
    initiativePassiveSkills: displaySettings.initiativePassiveSkills.filter((skill) => skill.id !== editingInitiativeSkillId),
  });
  byId("initiative-skill-dialog")?.close();
  void saveDisplaySettings();
});

function renderDisplaySettingsControls() {
  const controls = {
    "wounds-color": displaySettings.woundsColor,
    "stress-color": displaySettings.stressColor,
    "wounds-background-color": displaySettings.woundsBackgroundColor,
    "stress-background-color": displaySettings.stressBackgroundColor,
    "bar-size": displaySettings.barSize,
    "bar-alignment": displaySettings.barAlignment,
    "bar-text-color": displaySettings.barTextColor,
    "bar-font": displaySettings.barFont,
    "defense-size": displaySettings.defenseSize,
    "defense-alignment": displaySettings.defenseAlignment,
    "defense-color": displaySettings.defenseColor,
    "defense-font": displaySettings.defenseFont,
    "evasion-background-color": displaySettings.evasionBackgroundColor,
    "protection-background-color": displaySettings.protectionBackgroundColor,
    "conviction-background-color": displaySettings.convictionBackgroundColor,
    "name-size": displaySettings.nameSize,
    "name-alignment": displaySettings.nameAlignment,
    "name-color": displaySettings.nameColor,
    "name-font": displaySettings.nameFont,
    "bar-placement": displaySettings.barPlacement,
  };
  for (const [id, value] of Object.entries(controls)) {
    const control = byId(id);
    if (control && control.value !== value) control.value = value;
  }
  const nameSizeOutput = byId("name-size-output");
  if (nameSizeOutput) nameSizeOutput.textContent = `${displaySettings.nameSize}%`;
  const canEdit = currentRole === "GM";
  const appearancePanel = byId("token-appearance-panel");
  const initiativeDetailsPanel = byId("initiative-detail-settings-panel");
  if (appearancePanel) appearancePanel.hidden = !canEdit;
  if (initiativeDetailsPanel) initiativeDetailsPanel.hidden = !canEdit;
  for (const id of Object.keys(controls)) {
    const control = byId(id);
    if (control) control.disabled = !canEdit;
  }
  const note = byId("settings-permission-note");
  if (note) note.textContent = "As configurações das barras são compartilhadas por todos na sala.";
  renderInitiativePreview();
}

function setTokenSettingsTab(tabId) {
  for (const panel of document.querySelectorAll("[data-token-settings-panel]")) {
    panel.hidden = panel.dataset.tokenSettingsPanel !== tabId;
  }
  for (const tab of document.querySelectorAll("[data-token-settings-tab]")) {
    const active = tab.dataset.tokenSettingsTab === tabId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

document.querySelectorAll("[data-token-settings-tab]").forEach((tab) => {
  tab.addEventListener("click", () => setTokenSettingsTab(tab.dataset.tokenSettingsTab));
});

async function refreshDisplaySettings(metadata = null) {
  try {
    const roomMetadata = metadata ?? await OBR.room.getMetadata();
    displaySettings = normalizeDisplaySettings(roomMetadata?.[DISPLAY_SETTINGS_KEY]);
    renderDisplaySettingsControls();
    return true;
  } catch (error) {
    console.error("A&A: não foi possível carregar as configurações das barras.", error);
    setSettingsNotice("Não foi possível carregar as configurações da sala.", "error");
    return false;
  }
}

async function saveDisplaySettings() {
  if (currentRole !== "GM") {
    renderDisplaySettingsControls();
    setSettingsNotice("Somente o mestre pode alterar as configurações compartilhadas.", "warning");
    return;
  }
  const next = normalizeDisplaySettings({
    woundsColor: byId("wounds-color").value,
    stressColor: byId("stress-color").value,
    woundsBackgroundColor: byId("wounds-background-color").value,
    stressBackgroundColor: byId("stress-background-color").value,
    barSize: byId("bar-size").value,
    barAlignment: byId("bar-alignment").value,
    barTextColor: byId("bar-text-color").value,
    barFont: byId("bar-font").value,
    defenseSize: byId("defense-size").value,
    defenseAlignment: byId("defense-alignment").value,
    defenseColor: byId("defense-color").value,
    defenseFont: byId("defense-font").value,
    evasionBackgroundColor: byId("evasion-background-color").value,
    protectionBackgroundColor: byId("protection-background-color").value,
    convictionBackgroundColor: byId("conviction-background-color").value,
    initiativeShowWounds: true,
    initiativeWoundsMode: "bar",
    initiativeShowStress: true,
    initiativeStressMode: "bar",
    initiativeShowEvasion: displaySettings.initiativeShowEvasion,
    initiativeShowProtection: displaySettings.initiativeShowProtection,
    initiativeShowConviction: displaySettings.initiativeShowConviction,
    initiativePassiveSkills: displaySettings.initiativePassiveSkills,
    nameSize: byId("name-size").value,
    nameAlignment: byId("name-alignment").value,
    nameColor: byId("name-color").value,
    nameFont: byId("name-font").value,
    barPlacement: byId("bar-placement").value,
  });
  settingsWriteQueue = settingsWriteQueue.then(async () => {
    await OBR.room.setMetadata({ [DISPLAY_SETTINGS_KEY]: next });
    displaySettings = next;
    renderDisplaySettingsControls();
    setSettingsNotice("Configurações das barras salvas para a sala.", "success");
  }).catch(async (error) => {
    console.error("A&A: não foi possível salvar as configurações das barras.", error);
    await refreshDisplaySettings();
    setSettingsNotice("Não foi possível salvar. Verifique as permissões da sala.", "error");
  });
  return settingsWriteQueue;
}

for (const id of ["wounds-color", "stress-color", "wounds-background-color", "stress-background-color", "bar-size", "bar-alignment", "bar-text-color", "bar-font", "defense-size", "defense-alignment", "defense-color", "defense-font", "evasion-background-color", "protection-background-color", "conviction-background-color", "name-size", "name-alignment", "name-color", "name-font", "bar-placement"]) {
  byId(id)?.addEventListener("change", () => void saveDisplaySettings());
}
byId("name-size")?.addEventListener("input", () => {
  const output = byId("name-size-output");
  if (output) output.textContent = `${byId("name-size").value}%`;
});

const resetTokenAppearanceButton = byId("reset-token-appearance");
const resetTokenAppearanceDialog = byId("reset-token-appearance-dialog");
const cancelResetTokenAppearanceButton = byId("cancel-reset-token-appearance");
const confirmResetTokenAppearanceButton = byId("confirm-reset-token-appearance");

resetTokenAppearanceButton?.addEventListener("click", () => {
  if (currentRole !== "GM") {
    setSettingsNotice("Somente o mestre pode restaurar a aparência dos tokens.", "warning");
    return;
  }
  resetTokenAppearanceDialog?.showModal();
});
cancelResetTokenAppearanceButton?.addEventListener("click", () => resetTokenAppearanceDialog?.close());
resetTokenAppearanceDialog?.addEventListener("click", (event) => {
  if (event.target === resetTokenAppearanceDialog) resetTokenAppearanceDialog.close();
});
confirmResetTokenAppearanceButton?.addEventListener("click", () => {
  if (currentRole !== "GM") {
    resetTokenAppearanceDialog?.close();
    setSettingsNotice("Somente o mestre pode restaurar a aparência dos tokens.", "warning");
    return;
  }
  confirmResetTokenAppearanceButton.disabled = true;
  settingsWriteQueue = settingsWriteQueue.then(async () => {
    const defaults = { ...DEFAULT_DISPLAY_SETTINGS };
    await OBR.room.setMetadata({ [DISPLAY_SETTINGS_KEY]: defaults });
    displaySettings = defaults;
    renderDisplaySettingsControls();
    resetTokenAppearanceDialog?.close();
    setSettingsNotice("A aparência padrão dos tokens foi restaurada.", "success");
  }).catch(async (error) => {
    console.error("A&A: não foi possível restaurar a aparência dos tokens.", error);
    await refreshDisplaySettings();
    setSettingsNotice("Não foi possível restaurar a aparência. Verifique as permissões da sala.", "error");
  }).finally(() => {
    confirmResetTokenAppearanceButton.disabled = false;
  });
});
byId("interface-theme")?.addEventListener("change", (event) => {
  applyLocalTheme(event.target.value);
});
byId("custom-theme-controls")?.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.themeColor) {
    themeController.updateCustomization({ [input.dataset.themeColor]: input.value });
  } else if (input.dataset.themeSetting) {
    const value = Number(input.value);
    themeController.updateCustomization({ [input.dataset.themeSetting]: value });
    if (input.dataset.themeSetting === "transparency") byId("theme-transparency-value").textContent = `${value}%`;
    if (input.dataset.themeSetting === "radius") byId("theme-radius-value").textContent = `${value} px`;
  }
});
byId("reset-custom-theme")?.addEventListener("click", () => {
  themeController.resetCustomization();
  renderThemeControls();
});
window.addEventListener("storage", (event) => {
  if (!event.key || event.key === THEME_STORAGE_KEY || event.key === THEME_CUSTOMIZATION_KEY) renderThemeControls();
});
initializeLocalTheme();

function getImageUrl(item, entry) {
  const candidate = item?.image?.url ?? "";
  if (typeof candidate !== "string") return "";
  try {
    const parsed = new URL(candidate, window.location.href);
    return ["http:", "https:", "blob:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function makeResourceAdjustmentButton(tokenId, resourceClass, delta, preview = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "initiative-detail-adjust-button";
  button.textContent = delta < 0 ? "‹" : "›";
  button.dataset.adjustResource = resourceClass;
  button.dataset.resourceTokenId = tokenId ?? "";
  button.dataset.resourceDelta = String(delta);
  button.disabled = preview || !showDetailedInitiative || !tokenId;
  const label = resourceClass === "wounds" ? "Ferimentos" : "Estresses";
  button.title = `${delta < 0 ? "Diminuir" : "Aumentar"} ${label}`;
  button.setAttribute("aria-label", button.title);
  return button;
}

function makeResourceValueControls(tokenId, resourceClass, valueText, preview = false) {
  const controls = document.createElement("span");
  controls.className = "initiative-detail-resource-controls";
  const value = document.createElement("span");
  value.className = "initiative-detail-resource-value";
  value.textContent = valueText;
  controls.append(
    makeResourceAdjustmentButton(tokenId, resourceClass, -1, preview),
    value,
    makeResourceAdjustmentButton(tokenId, resourceClass, 1, preview),
  );
  return controls;
}

function makeInitiativeResourceStatus(label, currentValue, maxValue, resourceClass, tokenId, preview = false, masked = false, thresholds = []) {
  const current = Math.max(0, Number.parseInt(currentValue, 10) || 0);
  const max = Math.max(0, Number.parseInt(maxValue, 10) || 0);
  const item = document.createElement("div");
  item.className = `initiative-detail-resource initiative-detail-${resourceClass}`;
  const title = document.createElement("span");
  title.className = "initiative-detail-resource-label";
  title.textContent = label;
  const track = document.createElement("div");
  track.className = "initiative-detail-resource-track";
  const backgroundColor = resourceClass === "wounds" ? displaySettings.woundsBackgroundColor : displaySettings.stressBackgroundColor;
  const backgroundMatch = /^#([0-9a-f]{6})$/i.exec(String(backgroundColor ?? ""));
  if (backgroundMatch) {
    const hex = backgroundMatch[1];
    track.style.backgroundColor = `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, 0.25)`;
    track.style.borderColor = `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, 0.45)`;
  }
  const fill = document.createElement("span");
  fill.className = "initiative-detail-resource-fill";
  fill.style.width = `${max > 0 ? Math.min(100, current / max * 100) : 0}%`;
  fill.style.backgroundColor = resourceClass === "wounds" ? displaySettings.woundsColor : displaySettings.stressColor;
  const addThresholdMarkers = () => {
    for (const threshold of thresholds) {
      const numeric = Math.max(0, Number(threshold) || 0);
      if (max <= 0 || numeric <= 0 || numeric >= max) continue;
      const marker = document.createElement("span");
      marker.className = "initiative-detail-resource-marker";
      marker.style.left = `${Math.min(100, numeric / max * 100)}%`;
      marker.setAttribute("aria-hidden", "true");
      track.append(marker);
    }
  };
  if (masked) {
    track.classList.add("initiative-detail-resource-track-masked");
    const line = document.createElement("div");
    line.className = "initiative-detail-resource-line";
    line.append(title);
    track.append(fill, line);
    addThresholdMarkers();
    item.append(track);
    return item;
  }
  const line = document.createElement("div");
  line.className = "initiative-detail-resource-line";
  const controls = makeResourceValueControls(tokenId, resourceClass, `${current}/${max}`, preview);
  line.append(title, controls);
  track.append(fill, line);
  addThresholdMarkers();
  item.append(track);
  return item;
}

function contrastTextForHex(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!match) return displaySettings.defenseColor || "#ffffff";
  const value = match[1];
  const rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.45 ? "#171717" : "#ffffff";
}

function makeInitiativeDetails(item, preview = false, masked = false) {
  const sheet = item?.metadata?.[SHEET_KEY];
  if (!sheet || typeof sheet !== "object") return null;
  const details = document.createElement("div");
  details.className = "initiative-entry-details";
  const tokenId = preview ? null : item?.id;
  const resourceGroup = document.createElement("div");
  resourceGroup.className = "initiative-details-resources";

  const woundsCurrent = Math.max(0, Number(sheet.resourceOneNormal ?? sheet.resourceOneCurrent ?? 0) || 0)
    + Math.max(0, Number(sheet.resourceOneChronic ?? 0) || 0);
  const woundsMax = Math.max(0, Number(sheet.resourceOneDead ?? 20) || 0);
  const stressCurrent = Math.max(0, Number(sheet.resourceTwoNormal ?? sheet.resourceTwoCurrent ?? 0) || 0)
    + Math.max(0, Number(sheet.resourceTwoChronic ?? 0) || 0);
  const stressMax = Math.max(0, Number(sheet.resourceTwoInsano ?? 20) || 0);

  resourceGroup.append(
    makeInitiativeResourceStatus("Ferimentos", woundsCurrent, woundsMax, "wounds", tokenId, preview, masked, [sheet.resourceOneWounded ?? 5, sheet.resourceOneUnconscious ?? 10]),
    makeInitiativeResourceStatus("Estresses", stressCurrent, stressMax, "stress", tokenId, preview, masked, [sheet.resourceTwoStressed ?? 5, sheet.resourceTwoEnlouquecendo ?? sheet.resourceTwoUnconscious ?? 10]),
  );
  details.append(resourceGroup);
  if (masked) {
    details.classList.add("initiative-entry-details-masked");
    return details;
  }

  const metaGroup = document.createElement("div");
  metaGroup.className = "initiative-details-meta";
  const definitions = [
    ["EVA", "initiativeShowEvasion", sheet.evasion],
    ["PRO", "initiativeShowProtection", sheet.protection],
    ["CON", "initiativeShowConviction", sheet.conviction],
  ];
  const visibleDefinitions = preview
    ? definitions
    : definitions.filter(([, settingKey]) => displaySettings[settingKey]);
  const defenseGroup = document.createElement("div");
  defenseGroup.className = "initiative-details-defenses";
  for (const [label, settingKey, value] of visibleDefinitions) {
    const enabled = Boolean(displaySettings[settingKey]);
    const chip = document.createElement(preview ? "button" : "span");
    if (preview) {
      chip.type = "button";
      chip.dataset.toggleInitiativeDefense = settingKey;
      chip.setAttribute("aria-pressed", String(enabled));
      chip.title = enabled ? `Clique para ocultar ${label}` : `Clique para mostrar ${label}`;
    }
    chip.className = `initiative-detail-defense initiative-detail-defense-${label.toLowerCase()}${preview && !enabled ? " is-hidden-preview" : ""}`;
    const defenseBackground = label === "EVA" ? displaySettings.evasionBackgroundColor
      : label === "PRO" ? displaySettings.protectionBackgroundColor
        : displaySettings.convictionBackgroundColor;
    chip.style.backgroundColor = defenseBackground;
    chip.style.borderColor = defenseBackground;
    chip.style.color = displaySettings.defenseColor;
    chip.textContent = `${label} ${value === "" || value === null || value === undefined ? "–" : value}`;
    defenseGroup.append(chip);
  }
  if (preview) {
    const addSkill = document.createElement("button");
    addSkill.type = "button";
    addSkill.className = "initiative-add-skill-preview";
    addSkill.dataset.addInitiativeSkill = "true";
    addSkill.textContent = "+";
    addSkill.title = "Adicionar perícia à iniciativa detalhada";
    addSkill.setAttribute("aria-label", addSkill.title);
    defenseGroup.append(addSkill);
  }
  if (defenseGroup.childElementCount) metaGroup.append(defenseGroup);

  const configuredSkills = displaySettings.initiativePassiveSkills;
  const savedSkills = Array.isArray(sheet.skills) ? sheet.skills : [];
  const skillsGroup = document.createElement("div");
  skillsGroup.className = "initiative-details-passive-skills";
  for (const configured of configuredSkills) {
    const definition = INITIATIVE_SKILLS.find((skill) => skill.id === configured.id);
    const savedSkill = savedSkills.find((skill) => String(skill?.id ?? "") === configured.id);
    if (!definition || !savedSkill) continue;
    const rank = Math.max(1, Math.min(5, Number.parseInt(savedSkill.rank, 10) || 1));
    const value = configured.passive ? 4 + rank : rank;
    const label = `${definition.name}${configured.passive ? " Passiva" : ""} ${value}`;
    const chip = document.createElement(preview ? "button" : "span");
    if (preview) {
      chip.type = "button";
      chip.dataset.editInitiativeSkill = configured.id;
      chip.title = `Clique para editar ou remover ${definition.name}`;
    }
    chip.className = "initiative-detail-passive-skill";
    if (configured.color) {
      chip.style.backgroundColor = configured.color;
      chip.style.borderColor = configured.color;
      chip.style.color = contrastTextForHex(configured.color);
    }
    chip.textContent = label;
    chip.title ||= configured.passive ? `${definition.name} Passiva: ${value}` : `${definition.name}: valor treinado ${value}`;
    skillsGroup.append(chip);
  }
  if (skillsGroup.childElementCount) metaGroup.append(skillsGroup);
  if (metaGroup.childElementCount) details.append(metaGroup);
  return details.childElementCount ? details : null;
}

function renderInitiativePreview() {
  const host = byId("initiative-preview-card");
  if (!host) return;
  const previewId = "aa-initiative-preview-token";
  const sampleSheet = {
    resourceOneNormal: 3,
    resourceOneChronic: 1,
    resourceOneUnconscious: 10,
    resourceTwoNormal: 2,
    resourceTwoChronic: 0,
    resourceTwoUnconscious: 10,
    evasion: 12,
    protection: 3,
    conviction: 8,
    skills: INITIATIVE_SKILLS.map((skill, index) => ({ id: skill.id, rank: (index % 5) + 1 })),
  };
  const item = { id: previewId, name: "Exemplo de personagem", metadata: { [SHEET_KEY]: sampleSheet }, visible: true };
  const entry = { tokenId: previewId, name: item.name, initiative: 18 };
  const state = { entries: [entry], activeTokenId: previewId, round: 1 };
  host.replaceChildren(makeInitiativeRow(entry, item, state, 0, true));
}

byId("initiative-preview-card")?.addEventListener("click", (event) => {
  if (currentRole !== "GM") return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const defense = target.closest("[data-toggle-initiative-defense]");
  if (defense) {
    const settingKey = defense.dataset.toggleInitiativeDefense;
    if (!["initiativeShowEvasion", "initiativeShowProtection", "initiativeShowConviction"].includes(settingKey)) return;
    displaySettings = normalizeDisplaySettings({ ...displaySettings, [settingKey]: !displaySettings[settingKey] });
    void saveDisplaySettings();
    return;
  }
  if (target.closest("[data-add-initiative-skill]")) {
    openInitiativeSkillDialog();
    return;
  }
  const skill = target.closest("[data-edit-initiative-skill]");
  if (skill) openInitiativeSkillDialog(skill.dataset.editInitiativeSkill);
});

function makeInitiativeRow(entry, item, state, index, preview = false) {
  const row = document.createElement("article");
  row.className = "initiative-entry";
  row.dataset.initiativeTokenId = entry.tokenId;
  row.classList.toggle("active-turn", entry.tokenId === state.activeTokenId);
  row.setAttribute("aria-current", entry.tokenId === state.activeTokenId ? "true" : "false");

  const avatar = document.createElement("button");
  avatar.type = "button";
  avatar.className = "initiative-token-icon";
  avatar.dataset.focusToken = entry.tokenId;
  avatar.disabled = preview;
  avatar.setAttribute("aria-label", `Centralizar câmera em ${item?.name ?? entry.name ?? "Personagem"}`);
  const url = getImageUrl(item, entry);
  if (url) {
    const image = document.createElement("img");
    image.className = "initiative-token-image";
    image.src = url;
    image.alt = "";
    image.draggable = false;
    image.addEventListener("error", () => {
      image.remove();
      const initial = document.createElement("span");
      initial.className = "initiative-token-fallback";
      initial.textContent = (item?.name ?? entry.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
      avatar.append(initial);
    }, { once: true });
    avatar.append(image);
  } else {
    const initial = document.createElement("span");
    initial.className = "initiative-token-fallback";
    initial.textContent = (item?.name ?? entry.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
    avatar.append(initial);
  }

  const displayName = String(item?.name ?? entry.name ?? "Personagem");
  const name = document.createElement("button");
  name.type = "button";
  name.className = "initiative-entry-name";
  name.textContent = displayName;
  name.title = `Centralizar câmera em ${displayName}`;
  name.dataset.focusToken = entry.tokenId;
  name.disabled = preview;

  const hiddenDetails = currentRole !== "GM" && Boolean(item?.metadata?.[SHEET_KEY]?.hideFromPlayers);
  let value;
  if (hiddenDetails) {
    value = document.createElement("span");
    value.className = "initiative-value initiative-value-hidden";
    value.textContent = "??";
    value.setAttribute("aria-label", `Iniciativa de ${displayName} oculta`);
  } else {
    value = document.createElement("button");
    value.className = "initiative-value initiative-value-button";
    value.type = "button";
    value.textContent = entry.initiative === null ? "—" : String(entry.initiative);
    value.dataset.editInitiative = entry.tokenId;
    value.disabled = preview;
    value.dataset.currentInitiative = entry.initiative === null ? "" : String(entry.initiative);
    value.setAttribute("aria-label", `Alterar iniciativa de ${displayName}, valor atual ${entry.initiative === null ? "vazio" : entry.initiative}`);
    value.title = "Clique para alterar a iniciativa";
  }

  row.append(avatar, name, value);
  if (!hiddenDetails) {
    const remove = document.createElement("button");
    remove.className = "initiative-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remover ${displayName} da iniciativa`;
    remove.setAttribute("aria-label", remove.title);
    remove.dataset.removeInitiative = entry.tokenId;
    remove.disabled = preview;
    row.append(remove);
  } else {
    row.classList.add("no-remove");
  }

  if (preview || showDetailedInitiative) {
    const details = makeInitiativeDetails(item, preview, hiddenDetails);
    if (details) row.append(details);
  }
  row.style.setProperty("--initiative-order", String(index));
  return row;
}

function formatRollHistoryTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Horário desconhecido";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

const LOG_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀", "💀", "🤔", "👏", "✅"];

function makeLogReactionButton(entry, emoji, users, isPickerOption = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isPickerOption ? "log-reaction-option" : "log-reaction-chip";
  button.dataset.logReaction = entry.id;
  button.dataset.reactionEmoji = emoji;
  button.textContent = isPickerOption ? emoji : `${emoji} ${users.length}`;
  const selected = Boolean(currentPlayerKey && users.includes(currentPlayerKey));
  button.setAttribute("aria-pressed", String(selected));
  button.title = isPickerOption
    ? `Reagir com ${emoji}`
    : `${users.length} ${users.length === 1 ? "reação" : "reações"} ${emoji}`;
  button.setAttribute("aria-label", isPickerOption ? `Reagir com ${emoji}` : `${emoji}, ${users.length} reações`);
  if (!currentPlayerKey) button.disabled = true;
  return button;
}

function updateTestResultForCard(card, rawDt = null) {
  const entry = card?.rollHistoryEntry;
  const output = card?.querySelector("[data-roll-result]");
  const input = card?.querySelector("[data-roll-dt]");
  if (!entry || !output || !input) return;
  const result = calculateTestResult(entry, rawDt === null ? input.value : rawDt);
  if (!input.value || !result) {
    output.textContent = "";
    output.hidden = true;
    output.dataset.result = "";
    const details = output.closest(".roll-history-details");
    if (details) details.hidden = true;
    return;
  }
  output.hidden = false;
  const details = output.closest(".roll-history-details");
  if (details) details.hidden = false;
  output.dataset.result = result.success ? "success" : "failure";
  output.textContent = `${result.success ? "Sucesso" : "Falha"}. Total ${result.total}, ${result.criticals} ${result.criticals === 1 ? "crítico" : "críticos"}.`;
}

function makeRollHistoryEntry(entry) {
  const card = document.createElement("article");
  card.className = "roll-history-entry";
  card.dataset.logEntryId = entry.id;
  card.dataset.logType = entry.type;
  if (entry.kind) card.dataset.abilityKind = entry.kind;
  card.rollHistoryEntry = entry;

  const senderName = String(entry.characterName ?? "").trim();
  const focusable = Boolean(entry.tokenId);
  const heading = document.createElement("div");
  heading.className = "roll-history-heading";
  const avatar = document.createElement("button");
  avatar.type = "button";
  avatar.className = "log-sender-avatar log-focus-button";
  avatar.setAttribute("aria-label", senderName ? `Centralizar ${senderName} no mapa` : "Centralizar token no mapa");
  avatar.disabled = !focusable;
  if (entry.tokenId) avatar.dataset.focusToken = entry.tokenId;
  const avatarFallback = senderName.slice(0, 1).toUpperCase() || "?";
  avatar.textContent = avatarFallback;

  const headingContent = document.createElement("div");
  headingContent.className = "roll-history-heading-content";
  const identityRow = document.createElement("div");
  identityRow.className = "roll-history-identity-row";
  const participantNames = document.createElement("div");
  participantNames.className = "roll-history-participants";

  if (senderName) {
    const characterName = document.createElement("button");
    characterName.type = "button";
    characterName.className = "log-character-name log-focus-name";
    characterName.textContent = senderName;
    characterName.disabled = !focusable;
    characterName.setAttribute("aria-label", `Centralizar ${senderName} no mapa`);
    if (entry.tokenId) characterName.dataset.focusToken = entry.tokenId;
    participantNames.append(characterName);
  }
  if (senderName && entry.playerName) {
    const separator = document.createElement("span");
    separator.className = "log-name-separator";
    separator.textContent = "·";
    participantNames.append(separator);
  }
  const playerName = document.createElement("strong");
  playerName.className = "log-player-name";
  playerName.textContent = String(entry.playerName ?? "Jogador").trim() || "Jogador";
  participantNames.append(playerName);

  const time = document.createElement("time");
  time.className = "roll-history-time";
  time.dateTime = new Date(entry.rolledAt).toISOString();
  time.textContent = formatRollHistoryTime(entry.rolledAt);
  identityRow.append(participantNames, time);
  headingContent.append(identityRow);

  if (entry.type === "skill-roll" && entry.skillName) {
    const subtitle = document.createElement("div");
    subtitle.className = "roll-history-subtitle";
    subtitle.textContent = entry.skillName;
    headingContent.append(subtitle);
  } else if (entry.type === "manual-roll" && entry.dice?.length) {
    const subtitle = document.createElement("div");
    subtitle.className = "roll-history-subtitle";
    subtitle.textContent = `${entry.dice.length}d10`;
    headingContent.append(subtitle);
  }

  const details = document.createElement("div");
  details.className = "roll-history-details";
  if (entry.type === "skill-roll" || entry.type === "manual-roll") {
    const resultOutput = document.createElement("strong");
    resultOutput.className = "roll-history-test-result";
    resultOutput.dataset.rollResult = entry.id;
    resultOutput.hidden = true;
    details.append(resultOutput);
    headingContent.append(details);
  }
  heading.append(avatar, headingContent);
  card.append(heading);

  if (entry.type === "ability-use") {
    const abilityTitle = document.createElement("div");
    abilityTitle.className = "roll-history-ability-title";
    abilityTitle.textContent = String(entry.abilityName ?? "").trim() || "Habilidade sem nome";
    card.append(abilityTitle);
  }

  if (entry.type === "skill-roll" || entry.type === "manual-roll") {
    const diceRow = document.createElement("div");
    diceRow.className = "roll-history-dice-row";
    const dice = document.createElement("div");
    dice.className = "roll-history-dice";
    dice.setAttribute("aria-label", `Resultados atuais: ${entry.dice.map(activeDieValue).join(", ")}`);
    for (const [index, dieData] of entry.dice.entries()) {
      const group = document.createElement("span");
      group.className = "roll-history-die-group";
      const values = dieData.rolls;
      for (const oldValue of values.slice(0, -1)) {
        const discarded = document.createElement("span");
        discarded.className = oldValue === 10 ? "roll-history-die roll-history-die-ten roll-history-die-discarded" : "roll-history-die roll-history-die-discarded";
        discarded.textContent = String(oldValue);
        discarded.title = `Resultado anterior descartado: ${oldValue}`;
        group.append(discarded);
      }
      const value = activeDieValue(dieData);
      const die = document.createElement("button");
      die.type = "button";
      die.className = value === 10 ? "roll-history-die roll-history-die-ten roll-history-die-current" : "roll-history-die roll-history-die-current";
      die.textContent = String(value);
      die.dataset.rerollEntry = entry.id;
      die.dataset.rerollDieIndex = String(index);
      die.title = `Clique para rerrolar o d10 ${index + 1}: ${value}`;
      die.setAttribute("aria-label", `Rerrolar o dado ${index + 1}, resultado atual ${value}`);
      if (values.length >= MAX_DIE_RESULTS) {
        die.disabled = true;
        die.title = `Limite de rerrolagens atingido para o dado ${index + 1}`;
      }
      group.append(die);
      dice.append(group);
    }
    diceRow.append(dice);

    const testRow = document.createElement("div");
    testRow.className = "roll-history-test-row";
    const dtLabel = document.createElement("label");
    dtLabel.className = "roll-history-dt-label";
    dtLabel.textContent = "DT";
    const dtInput = document.createElement("input");
    dtInput.type = "number";
    dtInput.min = "0";
    dtInput.max = "9999";
    dtInput.step = "1";
    dtInput.inputMode = "numeric";
    dtInput.className = "roll-history-dt-input";
    dtInput.dataset.rollDt = entry.id;
    dtInput.value = entry.dt === null || entry.dt === undefined ? "" : String(entry.dt);
    dtInput.placeholder = "DT";
    dtInput.setAttribute("aria-label", `Dificuldade do teste de ${entry.type === "skill-roll" ? entry.skillName : entry.rollName}`);
    dtLabel.append(dtInput);
    testRow.append(dtLabel);
    diceRow.append(testRow);
    card.append(diceRow);
    if (entry.dt !== null && entry.dt !== undefined) updateTestResultForCard(card, entry.dt);
  }

  if (entry.type === "ability-use" || entry.type === "chat-message") {
    const content = document.createElement("div");
    content.className = entry.type === "ability-use" ? "roll-history-ability-content" : "roll-history-chat-content";

    if (entry.type === "ability-use" && entry.traits?.length) {
      const traits = document.createElement("div");
      traits.className = "roll-history-ability-traits";
      for (const traitText of entry.traits) {
        const trait = document.createElement("span");
        trait.className = "ability-trait";
        renderInlineMarkdown(trait, traitText);
        traits.append(trait);
      }
      content.append(traits);
    }

    if (entry.inlineRolls?.length) {
      const inlineRollContainer = document.createElement("div");
      inlineRollContainer.className = "roll-history-inline-rolls";
      renderInlineRolls(inlineRollContainer, entry.inlineRolls, { entryId: entry.id });
      content.append(inlineRollContainer);
    }

    const rawText = entry.type === "ability-use" ? entry.description : entry.message;
    if (String(rawText ?? "").trim()) {
      const description = document.createElement("div");
      description.className = entry.type === "ability-use"
        ? "roll-history-ability-description ability-description"
        : "roll-history-chat-message ability-description";
      renderFormattedMarkdown(description, rawText, {
        inlineRolls: entry.inlineRolls,
        entryId: entry.id,
        showInlineResults: true,
      });
      content.append(description);
    }
    if (content.childElementCount) card.append(content);
  }

  const reactions = document.createElement("div");
  reactions.className = "log-reactions-row";
  for (const reaction of entry.reactions ?? []) {
    reactions.append(makeLogReactionButton(entry, reaction.emoji, reaction.users));
  }

  const pickerToggle = document.createElement("button");
  pickerToggle.type = "button";
  pickerToggle.className = "log-add-reaction";
  pickerToggle.dataset.toggleReactionPicker = entry.id;
  pickerToggle.textContent = "+";
  pickerToggle.title = "Adicionar reação";
  pickerToggle.setAttribute("aria-label", "Adicionar reação");
  pickerToggle.setAttribute("aria-expanded", "false");
  pickerToggle.disabled = !currentPlayerKey;
  reactions.append(pickerToggle);
  card.append(reactions);

  const picker = document.createElement("div");
  picker.className = "log-reaction-picker";
  picker.dataset.reactionPicker = entry.id;
  picker.hidden = true;
  for (const emoji of LOG_REACTION_EMOJIS) {
    const existingReaction = (entry.reactions ?? []).find((reaction) => reaction.emoji === emoji);
    picker.append(makeLogReactionButton(entry, emoji, existingReaction?.users ?? [], true));
  }
  card.append(picker);

  if (entry.tokenId || senderName) {
    void OBR.scene.items.getItems().then((items) => {
      if (!card.isConnected) return;
      const sender = (entry.tokenId ? items.find((item) => item.id === entry.tokenId) : null)
        ?? items.find((item) => item.type === "IMAGE" && (String(item.name ?? "").trim() === senderName
          || String(item.metadata?.["com.agentesaparicoes.character-sheet/sheet"]?.characterName ?? "").trim() === senderName));
      if (!sender) return;
      for (const button of card.querySelectorAll(".log-focus-button, .log-focus-name")) {
        button.dataset.focusToken = sender.id;
        button.disabled = false;
      }
      if (sender.image?.url) {
        const image = document.createElement("img");
        image.src = sender.image.url;
        image.alt = "";
        image.className = "log-sender-image";
        image.addEventListener("error", () => image.remove(), { once: true });
        avatar.replaceChildren(image);
      }
    }).catch(() => {});
  }

  return card;
}
async function refreshRollHistory(metadata = null) {
  const sequence = ++rollHistoryRenderSequence;
  try {
    const roomMetadata = metadata ?? await OBR.room.getMetadata();
    if (sequence !== rollHistoryRenderSequence) return;
    const history = normalizeRollHistory(roomMetadata?.[ROLL_HISTORY_KEY]);
    const newestFirst = [...history].reverse().sort((a, b) => b.rolledAt - a.rolledAt);
    const fragment = document.createDocumentFragment();
    newestFirst.forEach((roll) => fragment.append(makeRollHistoryEntry(roll)));
    rollHistoryList.replaceChildren(fragment);
    rollHistoryEmpty.hidden = newestFirst.length > 0;
    lastRollHistory = newestFirst;
    updateChatUnreadIndicator(lastRollHistory);
  } catch (error) {
    console.error("A&A: não foi possível carregar o histórico de rolagens.", error);
  }
}

async function refreshInitiativeView() {
  const sequence = ++renderSequence;
  try {
    const [metadata, sceneItems, sceneReady] = await Promise.all([
      OBR.room.getMetadata(),
      OBR.scene.items.getItems(() => true),
      OBR.scene.isReady(),
    ]);
    if (sequence !== renderSequence || !sceneReady) return;
    let state = normalizeInitiativeState(metadata?.[INITIATIVE_KEY]);
    const itemById = new Map(sceneItems.map((item) => [item.id, item]));
    const liveEntries = state.entries.filter((entry) => itemById.has(entry.tokenId));
    if (liveEntries.length !== state.entries.length) {
      state = normalizeInitiativeState({
        ...state,
        entries: liveEntries,
        activeTokenId: liveEntries.some((entry) => entry.tokenId === state.activeTokenId)
          ? state.activeTokenId
          : sortInitiativeEntries(liveEntries)[0]?.tokenId ?? null,
      });
      // Remove initiative records for tokens deleted from the current scene.
      // This also prevents the active-turn marker from pointing at a missing token.
      void writeInitiativeState(state).catch((error) => {
        console.warn("A&A: não foi possível limpar tokens removidos da iniciativa.", error);
      });
    }
    const sortedForTurnOrder = sortInitiativeEntries(state.entries);
    // Owlbear's native Hide/Show sets item.visible=false. Players must not
    // see even an empty row for such an entry. The GM retains the full list.
    const displayedEntries = sortedForTurnOrder.filter((entry) => {
      const item = itemById.get(entry.tokenId);
      if (!item) return false;
      return currentRole === "GM" || item.visible !== false;
    });
    const fragment = document.createDocumentFragment();
    displayedEntries.forEach((entry, index) => {
      fragment.append(makeInitiativeRow(entry, itemById.get(entry.tokenId), state, index));
    });
    initiativeList.replaceChildren(fragment);
    initiativeEmpty.hidden = displayedEntries.length > 0;
    initiativeDetailsToggle.hidden = false;
    initiativeDetailsToggle.classList.toggle("active", showDetailedInitiative);
    initiativeDetailsToggle.setAttribute("aria-pressed", String(showDetailedInitiative));
    initiativeDetailsToggle.setAttribute("aria-label", `${showDetailedInitiative ? "Esconder" : "Mostrar"} status detalhado`);
    initiativeDetailsToggle.title = `${showDetailedInitiative ? "Esconder" : "Mostrar"} status detalhado`;
    roundButton.textContent = `Rodada ${state.round}`;
    byId("previous-turn").disabled = !displayedEntries.length;
    byId("next-turn").disabled = !displayedEntries.length;
    byId("round-button").disabled = false;
    if (!initiativeNotice.matches(":focus")) {
      const activeTurnIsDisplayed = displayedEntries.some((entry) => entry.tokenId === state.activeTokenId);
      if (!displayedEntries.length) {
        setNotice("Adicione personagens pela ficha de cada token.", "info");
      } else if (currentRole !== "GM" && state.activeTokenId && !activeTurnIsDisplayed) {
        setNotice("O turno atual pertence a um token oculto para jogadores.", "info");
      } else {
        setNotice("Iniciativa sincronizada com a sala.", "info");
      }
    }
  } catch (error) {
    console.error("A&A: não foi possível carregar a iniciativa da sala.", error);
    setNotice("Não foi possível carregar a iniciativa. Confira se a extensão está aberta dentro de uma sala do Owlbear.", "error");
  }
}

function queueStateWrite(state, notice = "Iniciativa atualizada.") {
  writeQueue = writeQueue.then(async () => {
    await writeInitiativeState(state);
    setNotice(notice, "success");
    await refreshInitiativeView();
  }).catch((error) => {
    console.error("A&A: não foi possível salvar a iniciativa.", error);
    setNotice("Não foi possível salvar a iniciativa da sala. Verifique as permissões e a conexão.", "error");
  });
  return writeQueue;
}

async function setInitiativeValue(tokenId, value) {
  try {
    const state = await readInitiativeState();
    const entry = state.entries.find((item) => item.tokenId === tokenId);
    if (!entry) return;
    const trimmed = String(value ?? "").trim();
    const normalizedValue = trimmed.replace(",", ".");
    const parsed = normalizedValue === "" ? null : Number(normalizedValue);
    entry.initiative = Number.isFinite(parsed) ? Math.max(-9999, Math.min(99999, parsed)) : null;
    await queueStateWrite(state, "Valor de iniciativa atualizado.");
  } catch (error) {
    console.error(error);
    setNotice("Não foi possível alterar esse valor de iniciativa.", "error");
  }
}

async function adjustTokenResource(tokenId, resourceClass, delta) {
  if (!showDetailedInitiative) return;
  const resourceFields = resourceClass === "wounds"
    ? { normal: "resourceOneNormal", chronic: "resourceOneChronic" }
    : resourceClass === "stress"
      ? { normal: "resourceTwoNormal", chronic: "resourceTwoChronic" }
      : null;
  if (!resourceFields || !Number.isFinite(delta) || delta === 0) return;
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const item = items[0];
    const sheet = item?.metadata?.[SHEET_KEY];
    if (!item || !sheet || typeof sheet !== "object") {
      OBR.notification.show("Este token não possui uma ficha de A&A salva.");
      return;
    }
    if (currentRole !== "GM" && sheet.hideFromPlayers) {
      OBR.notification.show("Os recursos deste token estão ocultos pelo mestre.");
      return;
    }
    await OBR.scene.items.updateItems([item], (updatedItems) => {
      for (const target of updatedItems) {
        const storedSheet = target.metadata?.[SHEET_KEY];
        if (!storedSheet || typeof storedSheet !== "object") continue;
        const nextSheet = { ...storedSheet };
        const normal = Math.max(0, Number.parseInt(nextSheet[resourceFields.normal] ?? 0, 10) || 0);
        const chronic = Math.max(0, Number.parseInt(nextSheet[resourceFields.chronic] ?? 0, 10) || 0);
        if (delta > 0) {
          nextSheet[resourceFields.normal] = normal + delta;
        } else {
          let remaining = Math.abs(delta);
          const removeNormal = Math.min(normal, remaining);
          nextSheet[resourceFields.normal] = normal - removeNormal;
          remaining -= removeNormal;
          nextSheet[resourceFields.chronic] = Math.max(0, chronic - remaining);
        }
        target.metadata = { ...(target.metadata ?? {}), [SHEET_KEY]: nextSheet };
      }
    });
    await refreshInitiativeView();
  } catch (error) {
    console.error("A&A: não foi possível ajustar o recurso pela iniciativa.", error);
    OBR.notification.show("Não foi possível ajustar Ferimentos ou Estresses deste token.");
  }
}

async function removeFromInitiative(tokenId) {
  try {
    const state = await readInitiativeState();
    state.entries = state.entries.filter((entry) => entry.tokenId !== tokenId);
    if (state.activeTokenId === tokenId) {
      state.activeTokenId = sortInitiativeEntries(state.entries)[0]?.tokenId ?? null;
    }
    await queueStateWrite(state, "Personagem removido da iniciativa.");
  } catch (error) {
    console.error(error);
    setNotice("Não foi possível remover o personagem da iniciativa.", "error");
  }
}

async function advanceTurn(direction) {
  try {
    const state = await readInitiativeState();
    const sorted = sortInitiativeEntries(state.entries);
    if (!sorted.length) return;
    const currentIndex = sorted.findIndex((entry) => entry.tokenId === state.activeTokenId);
    if (currentIndex < 0) {
      state.activeTokenId = sorted[0].tokenId;
    } else if (direction > 0) {
      if (currentIndex >= sorted.length - 1) {
        state.activeTokenId = sorted[0].tokenId;
        state.round = Math.min(999999, state.round + 1);
      } else {
        state.activeTokenId = sorted[currentIndex + 1].tokenId;
      }
    } else if (currentIndex <= 0) {
      state.activeTokenId = sorted[sorted.length - 1].tokenId;
      state.round = Math.max(1, state.round - 1);
    } else {
      state.activeTokenId = sorted[currentIndex - 1].tokenId;
    }
    await queueStateWrite(state, "Turno atualizado.");
  } catch (error) {
    console.error(error);
    setNotice("Não foi possível avançar o turno.", "error");
  }
}

async function resetRounds() {
  try {
    const state = await readInitiativeState();
    state.round = 1;
    roundActions.hidden = true;
    roundButton.setAttribute("aria-expanded", "false");
    await queueStateWrite(state, "Rodadas reiniciadas. A rodada atual é 1.");
  } catch (error) {
    console.error(error);
    setNotice("Não foi possível resetar as rodadas.", "error");
  }
}

async function focusOnToken(tokenId) {
  try {
    const bounds = await OBR.scene.items.getItemBounds([tokenId]);
    if (bounds) {
      const padding = Math.max(bounds.width, bounds.height) * 0.9;
      await OBR.viewport.animateToBounds({ ...bounds, width: bounds.width + padding * 2, height: bounds.height + padding * 2 });
    }
  } catch (error) {
    console.error("A&A: não foi possível centralizar a câmera no personagem.", error);
    setNotice("Não foi possível centralizar a câmera nesse personagem.", "error");
  }
}

document.addEventListener("click", (event) => {
  const settingsCollapseButton = event.target.closest("#settings-view [data-collapse-target]");
  if (settingsCollapseButton && !settingsCollapseButton.disabled) {
    event.preventDefault();
    toggleSettingsCollapse(settingsCollapseButton);
    return;
  }

  const focusButton = event.target.closest("[data-focus-token]");
  if (focusButton) {
    void focusOnToken(focusButton.dataset.focusToken);
    return;
  }

  const tab = event.target.closest("[data-main-tab]");
  if (tab) {
    setMainTab(tab.dataset.mainTab);
    return;
  }

  const removeButton = event.target.closest("[data-remove-initiative]");
  if (removeButton) {
    void removeFromInitiative(removeButton.dataset.removeInitiative);
    return;
  }
});

rollHistoryList.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const inlineDieButton = target.closest("[data-inline-roll-entry][data-inline-roll-index][data-inline-die-index]");
  if (inlineDieButton) {
    const entryId = inlineDieButton.dataset.inlineRollEntry;
    const inlineRollIndex = Number(inlineDieButton.dataset.inlineRollIndex);
    const dieIndex = Number(inlineDieButton.dataset.inlineDieIndex);
    const card = inlineDieButton.closest(".roll-history-entry");
    const entry = card?.rollHistoryEntry;
    const roll = entry?.inlineRolls?.[inlineRollIndex];
    const die = roll?.dice?.[dieIndex];
    const values = Array.isArray(die?.rolls) ? die.rolls : (Number.isInteger(die) ? [die] : []);
    if (!entry || !roll || !values.length) return;
    if (values.length >= MAX_DIE_RESULTS) {
      OBR.notification.show("Este dado já atingiu o limite de rerrolagens.");
      return;
    }
    const currentValue = values[values.length - 1];
    openRerollDieDialog({ entryId, inlineRollIndex, dieIndex, currentValue });
    return;
  }

  const rerollButton = target.closest("[data-reroll-entry][data-reroll-die-index]");
  if (rerollButton) {
    const entryId = rerollButton.dataset.rerollEntry;
    const dieIndex = Number(rerollButton.dataset.rerollDieIndex);
    const card = rerollButton.closest(".roll-history-entry");
    const entry = card?.rollHistoryEntry;
    const die = entry?.dice?.[dieIndex];
    if (!entry || !die) return;
    if (die.rolls.length >= MAX_DIE_RESULTS) {
      OBR.notification.show("Este dado já atingiu o limite de rerrolagens.");
      return;
    }
    const currentValue = die.rolls[die.rolls.length - 1];
    openRerollDieDialog({ entryId, dieIndex, currentValue, inlineRollIndex: null });
    return;
  }

  const pickerToggle = target.closest("[data-toggle-reaction-picker]");
  if (pickerToggle) {
    const card = pickerToggle.closest(".roll-history-entry");
    const picker = card?.querySelector(".log-reaction-picker");
    if (picker) {
      picker.hidden = !picker.hidden;
      pickerToggle.setAttribute("aria-expanded", String(!picker.hidden));
    }
    return;
  }

  const reactionButton = target.closest("[data-log-reaction][data-reaction-emoji]");
  if (!reactionButton) return;
  if (!currentPlayerKey) {
    OBR.notification.show("Não foi possível identificar seu usuário para registrar a reação.");
    return;
  }

  try {
    const result = await toggleLogReaction(
      reactionButton.dataset.logReaction,
      reactionButton.dataset.reactionEmoji,
      currentPlayerKey,
    );
    if (!result.ok) {
      const message = result.reason === "emoji-limit"
        ? "Este evento já atingiu o limite de tipos de reação."
        : result.reason === "user-limit"
          ? "Este emoji já atingiu o limite de participantes."
          : result.reason === "missing"
            ? "Este evento não está mais no CHAT."
            : "Não foi possível registrar a reação.";
      OBR.notification.show(message);
      return;
    }
    await refreshRollHistory();
  } catch (error) {
    console.error("A&A: não foi possível registrar a reação.", error);
    OBR.notification.show("Não foi possível registrar a reação. Confira a conexão da sala.");
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

async function getSelectedChatToken() {
  try {
    const selection = await OBR.player.getSelection();
    if (!Array.isArray(selection) || !selection.length) return null;
    const items = await OBR.scene.items.getItems(selection);
    return items.find((item) => item.type === "IMAGE" && item.layer === "CHARACTER") ?? null;
  } catch (error) {
    console.debug("A&A: não foi possível ler a seleção atual para o CHAT.", error);
    return null;
  }
}

chatComposer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = String(chatInput.value ?? "").trim();
  if (!message || chatSendButton.disabled) return;

  chatSendButton.disabled = true;
  try {
    const [playerName, token] = await Promise.all([
      OBR.player.getName().catch(() => "Jogador"),
      getSelectedChatToken(),
    ]);
    const storedSheet = token?.metadata?.[`${EXTENSION_ID}/sheet`];
    const resolved = resolveInlineRolls(message, storedSheet?.skills ?? []);
    if (resolved.errors.length) {
      OBR.notification.show(resolved.errors[0]);
      chatInput.focus();
      return;
    }

    const entry = {
      type: "chat-message",
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rolledAt: Date.now(),
      playerName: String(playerName || "Jogador"),
      characterName: token
        ? String(storedSheet?.characterName ?? token.name ?? "Personagem").trim() || "Personagem"
        : "",
      tokenId: token?.id ?? "",
      message,
      inlineRolls: resolved.rolls,
    };
    await appendRollHistory(entry);
    chatInput.value = "";
    chatInput.style.height = "auto";
    await refreshRollHistory();
  } catch (error) {
    console.error("A&A: não foi possível enviar a mensagem no CHAT.", error);
    OBR.notification.show("Não foi possível enviar a mensagem. Confira a conexão da sala.");
  } finally {
    chatSendButton.disabled = false;
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatComposer.requestSubmit();
  }
});

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 112)}px`;
});

logRollButtons.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-roll-dice]");
  if (!button) return;
  const count = Number(button.dataset.rollDice);
  if (!Number.isInteger(count) || count < 1 || count > 5) return;

  logRollButtons.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  try {
    let playerName = "Jogador";
    try { playerName = (await OBR.player.getName()) || "Jogador"; } catch { /* fallback */ }
    const roll = {
      type: "manual-roll",
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerName,
      characterName: "Rolagem manual",
      rollName: "Rolagem manual",
      dice: Array.from({ length: count }, secureRandomD10),
      dt: null,
      rolledAt: Date.now(),
    };
    await appendRollHistory(roll);
    await refreshRollHistory();
  } catch (error) {
    console.error("A&A: não foi possível registrar a rolagem manual.", error);
    OBR.notification.show("Não foi possível registrar a rolagem. Confira a conexão da sala.");
  } finally {
    logRollButtons.querySelectorAll("button").forEach((item) => { item.disabled = false; });
  }
});

rollHistoryList.addEventListener("input", (event) => {
  const inlineInput = event.target.closest("[data-inline-roll-dt-entry][data-inline-roll-index]");
  if (inlineInput) {
    const card = inlineInput.closest(".roll-history-entry");
    const inlineIndex = Number(inlineInput.dataset.inlineRollIndex);
    const inlineRoll = card?.rollHistoryEntry?.inlineRolls?.[inlineIndex];
    if (inlineRoll) updateInlineRollTestResult(inlineInput.closest(".inline-roll-entry"), inlineRoll, inlineInput.value);
    return;
  }
  const input = event.target.closest("[data-roll-dt]");
  if (!input) return;
  updateTestResultForCard(input.closest(".roll-history-entry"));
});

rollHistoryList.addEventListener("change", async (event) => {
  const inlineInput = event.target.closest("[data-inline-roll-dt-entry][data-inline-roll-index]");
  if (inlineInput) {
    try {
      const result = await updateRollHistoryEntry(inlineInput.dataset.inlineRollDtEntry, {
        inlineRollIndex: Number(inlineInput.dataset.inlineRollIndex),
        inlineDt: inlineInput.value === "" ? null : inlineInput.value,
      });
      if (!result.ok) {
        OBR.notification.show(result.reason === "invalid-dt" ? "A DT deve ser um número inteiro entre 0 e 9999." : "Esta rolagem inline não está mais no CHAT.");
      }
      await refreshRollHistory();
    } catch (error) {
      console.error("A&A: não foi possível atualizar a DT da rolagem inline.", error);
      OBR.notification.show("Não foi possível salvar a DT. Confira a conexão da sala.");
      await refreshRollHistory();
    }
    return;
  }
  const input = event.target.closest("[data-roll-dt]");
  if (!input) return;
  try {
    const result = await updateRollHistoryEntry(input.dataset.rollDt, { dt: input.value === "" ? null : input.value });
    if (!result.ok) {
      OBR.notification.show(result.reason === "invalid-dt" ? "A DT deve ser um número inteiro entre 0 e 9999." : "Esta rolagem não está mais no CHAT.");
    }
    await refreshRollHistory();
  } catch (error) {
    console.error("A&A: não foi possível atualizar a DT da rolagem.", error);
    OBR.notification.show("Não foi possível salvar a DT. Confira a conexão da sala.");
    await refreshRollHistory();
  }
});

function openRerollDieDialog(pending) {
  pendingReroll = pending;
  rerollDieValueInput.value = "";
  confirmRerollDieButton.disabled = false;
  chooseRerollValueButton.disabled = false;
  if (typeof rerollDieDialog.showModal === "function") rerollDieDialog.showModal();
}

cancelRerollDieButton.addEventListener("click", () => {
  pendingReroll = null;
  rerollDieDialog.close();
});
rerollDieDialog.addEventListener("click", (event) => {
  if (event.target === rerollDieDialog) {
    pendingReroll = null;
    rerollDieDialog.close();
  }
});
rerollDieDialog.addEventListener("close", () => { pendingReroll = null; });

async function applyRerollValue(value) {
  if (!pendingReroll) return;
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    OBR.notification.show("Escolha um valor inteiro entre 1 e 10.");
    rerollDieValueInput.focus();
    return;
  }

  const pending = pendingReroll;
  confirmRerollDieButton.disabled = true;
  chooseRerollValueButton.disabled = true;
  try {
    // rerollLogDie appends the new value to the die's history, preserving
    // the struck-through previous values for both random and chosen results.
    const result = await rerollLogDie(pending.entryId, pending.dieIndex, value, pending.inlineRollIndex ?? null);
    if (!result.ok) {
      const message = result.reason === "reroll-limit"
        ? "Este dado já atingiu o limite de cinco rerrolagens."
        : "Esta rolagem não está mais no CHAT.";
      OBR.notification.show(message);
    } else {
      await refreshRollHistory();
    }
    pendingReroll = null;
    rerollDieDialog.close();
  } catch (error) {
    console.error("A&A: não foi possível alterar o resultado do dado.", error);
    OBR.notification.show("Não foi possível alterar o dado. Confira a conexão da sala.");
  } finally {
    confirmRerollDieButton.disabled = false;
    chooseRerollValueButton.disabled = false;
  }
}

confirmRerollDieButton.addEventListener("click", () => {
  void applyRerollValue(secureRandomD10());
});
chooseRerollValueButton.addEventListener("click", () => {
  const value = rerollDieValueInput.valueAsNumber;
  if (!rerollDieValueInput.value.trim() || !Number.isInteger(value) || value < 1 || value > 10) {
    OBR.notification.show("Escolha um valor inteiro entre 1 e 10.");
    rerollDieValueInput.focus();
    return;
  }
  void applyRerollValue(value);
});
rerollDieValueInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    chooseRerollValueButton.click();
  }
});

clearLogButton.addEventListener("click", () => {
  if (currentRole !== "GM") return;
  if (typeof clearLogDialog.showModal === "function") clearLogDialog.showModal();
});
cancelClearLogButton.addEventListener("click", () => clearLogDialog.close());
clearLogDialog.addEventListener("click", (event) => {
  if (event.target === clearLogDialog) clearLogDialog.close();
});
confirmClearLogButton.addEventListener("click", async () => {
  if (currentRole !== "GM") return;
  confirmClearLogButton.disabled = true;
  try {
    await clearRollHistory();
    await refreshRollHistory();
    clearLogDialog.close();
    OBR.notification.show("CHAT limpo para todos os participantes.");
  } catch (error) {
    console.error("A&A: não foi possível limpar o LOG.", error);
    OBR.notification.show("Não foi possível limpar o CHAT. Confira a conexão da sala.");
  } finally {
    confirmClearLogButton.disabled = false;
  }
});

initiativeList.addEventListener("click", (event) => {
  const adjustButton = event.target.closest("[data-adjust-resource]");
  if (adjustButton) {
    const tokenId = adjustButton.dataset.resourceTokenId;
    const delta = Number.parseInt(adjustButton.dataset.resourceDelta, 10);
    void adjustTokenResource(tokenId, adjustButton.dataset.adjustResource, delta);
    return;
  }
  const button = event.target.closest("[data-edit-initiative]");
  if (!button) return;
  const input = document.createElement("input");
  input.className = "initiative-value initiative-value-editor";
  input.type = "text";
  input.inputMode = "decimal";
  input.value = button.dataset.currentInitiative ?? "";
  input.placeholder = "—";
  input.dataset.initiativeValue = button.dataset.editInitiative;
  input.dataset.originalValue = input.value;
  input.setAttribute("aria-label", `Editar iniciativa de ${button.getAttribute("aria-label") ?? "personagem"}`);
  button.replaceWith(input);
  input.focus();
  input.select();
});

initiativeList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-initiative-value]");
  if (input) void setInitiativeValue(input.dataset.initiativeValue, input.value);
});
initiativeList.addEventListener("keydown", (event) => {
  const input = event.target.closest("[data-initiative-value]");
  if (!input) return;
  if (event.key === "Enter") {
    event.preventDefault();
    input.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    input.value = input.dataset.originalValue ?? "";
    input.blur();
  }
});

initiativeDetailsToggle.addEventListener("click", () => {
  showDetailedInitiative = !showDetailedInitiative;
  try { localStorage.setItem(DETAILED_INITIATIVE_STORAGE_KEY, String(showDetailedInitiative)); } catch { /* Local preference is optional. */ }
  initiativeDetailsToggle.classList.toggle("active", showDetailedInitiative);
  initiativeDetailsToggle.setAttribute("aria-pressed", String(showDetailedInitiative));
  initiativeDetailsToggle.setAttribute("aria-label", `${showDetailedInitiative ? "Esconder" : "Mostrar"} status detalhado`);
  initiativeDetailsToggle.title = `${showDetailedInitiative ? "Esconder" : "Mostrar"} status detalhado`;
  void refreshInitiativeView();
});

byId("previous-turn").addEventListener("click", () => void advanceTurn(-1));
byId("next-turn").addEventListener("click", () => void advanceTurn(1));
roundButton.addEventListener("click", () => {
  roundActions.hidden = !roundActions.hidden;
  roundButton.setAttribute("aria-expanded", String(!roundActions.hidden));
});
byId("reset-rounds").addEventListener("click", () => void resetRounds());

OBR.onReady(async () => {
  themeController.connect(OBR);
  setMainTab("initiative-view");
  try {
    try { await adaptActionPopoverForSmallScreens(); } catch (error) { console.debug("A&A: usando tamanho padrão do painel.", error); }
    try {
      currentRole = await OBR.player.getRole();
    } catch {
      currentRole = "PLAYER";
    }
    try {
      const playerId = OBR.player.id || await OBR.player.getId();
      currentPlayerKey = hashPlayerKey(playerId);
    } catch {
      currentPlayerKey = "";
    }
    try {
      originalActionIcon = await getDefaultActionIcon();
      actionPopoverOpen = await OBR.action.isOpen();
      actionOpenUnsubscribe = OBR.action.onOpenChange((isOpen) => {
        actionPopoverOpen = Boolean(isOpen);
        if (actionPopoverOpen && !byId("roll-history-view").hidden) markChatHistoryRead(lastRollHistory);
        else if (chatHistoryInitialized) updateChatUnreadIndicator(lastRollHistory);
      });
    } catch (error) {
      actionPopoverOpen = true;
      console.debug("A&A: não foi possível monitorar a abertura do painel.", error);
    }
    clearLogButton.hidden = currentRole !== "GM";
    initiativeDetailsToggle.hidden = false;
    try { showDetailedInitiative = localStorage.getItem(DETAILED_INITIATIVE_STORAGE_KEY) === "true"; } catch { showDetailedInitiative = false; }
    initiativeDetailsToggle.classList.toggle("active", showDetailedInitiative);
    initiativeDetailsToggle.setAttribute("aria-pressed", String(showDetailedInitiative));
    setTokenSettingsTab("bars");
    const [, settingsLoaded] = await Promise.all([
      refreshInitiativeView(),
      refreshDisplaySettings(),
      refreshRollHistory(),
    ]);
    if (settingsLoaded) setSettingsNotice("Configurações carregadas.", "success");
    roomMetadataUnsubscribe = OBR.room.onMetadataChange((metadata) => {
      void refreshDisplaySettings(metadata).then(() => refreshInitiativeView());
      void refreshRollHistory(metadata);
    });
    sceneItemsUnsubscribe = OBR.scene.items.onChange(() => void refreshInitiativeView());
    sceneReadyUnsubscribe = OBR.scene.onReadyChange((ready) => {
      if (ready) void refreshInitiativeView();
    });
  } catch (error) {
    console.error("A&A: não foi possível inicializar a extensão.", error);
    setNotice("Abra a extensão dentro de uma sala do Owlbear Rodeo.", "warning");
  }
});

window.addEventListener("orientationchange", () => {
  window.setTimeout(() => {
    void adaptActionPopoverForSmallScreens().catch((error) => console.debug("A&A: não foi possível redimensionar o painel.", error));
  }, 180);
});

window.addEventListener("beforeunload", () => {
  roomMetadataUnsubscribe?.();
  sceneItemsUnsubscribe?.();
  sceneReadyUnsubscribe?.();
  actionOpenUnsubscribe?.();
});
