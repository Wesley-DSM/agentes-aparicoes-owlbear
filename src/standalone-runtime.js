(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const form = byId("sheet-form");
  const notice = byId("notice");
  const payloadElement = byId("aa-sheet-data");
  const SKILL_GROUPS = [
    { name: "Resistências", skills: [{ id: "agilidade", name: "Agilidade" }, { id: "fortitude", name: "Fortitude" }, { id: "vontade", name: "Vontade" }] },
    { name: "Equipamentos", skills: [{ id: "armaduras", name: "Armaduras" }, { id: "armas-de-fogo", name: "Armas de Fogo" }, { id: "armas-simples", name: "Armas Simples" }] },
    { name: "Especialidades", skills: [
      { id: "acrobacia", name: "Acrobacia" }, { id: "artes", name: "Artes" }, { id: "atletismo", name: "Atletismo" },
      { id: "ciencias", name: "Ciências" }, { id: "cultura", name: "Cultura" }, { id: "destreza", name: "Destreza" },
      { id: "diplomacia", name: "Diplomacia" }, { id: "empatia", name: "Empatia" }, { id: "enganacao", name: "Enganação" },
      { id: "forca", name: "Força" }, { id: "furtividade", name: "Furtividade" }, { id: "intimidacao", name: "Intimidação" },
      { id: "ocultismo", name: "Ocultismo" }, { id: "percepcao", name: "Percepção" }, { id: "tatica", name: "Tática" }, { id: "tecnologia", name: "Tecnologia" },
    ] },
  ];
  const ALL_SKILLS = SKILL_GROUPS.flatMap((group) => group.skills.map((skill) => ({ ...skill, group: group.name })));
  const ROMAN_BY_RANK = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
  let originalPayload;
  let nameAppearance = null;
  let showTokenName = true;
  let resourceSettingsDraft = { woundsChronic: 0, stressChronic: 0 };
  let defenseActiveDraft = false;
  let editingEquipmentId = null;
  let editingEquipmentCategory = "supply";
  let editingEquipmentIsNew = false;
  let attackingWeaponId = null;

  function setNotice(message, type = "info") {
    notice.textContent = message;
    notice.dataset.type = type;
  }

  function createId(prefix = "entry") {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  }

  function nonNegative(value, fallback = 0, max = 9999) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : fallback;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return "";
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(0, number) : "";
  }

  function rankValue(value) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : 1;
  }

  function makeDefaultEquipment() {
    return [
      { id: "default-punch", defaultEquipmentKey: "punch", category: "weapon", name: "Punho", spaces: 0, description: "Multiataque, Marcial - Empunhadura: 1 Espaços: 0 Engates: 0 Discreta - Corporal: 1m - Aparar, Defletir.", weaponClass: "Marcial", skill: "armas-simples", damage: "Força", critical: "1", reactionEvasion: 0, reactionProtection: 0, reactionActive: false },
      { id: "default-no-armor", defaultEquipmentKey: "no-armor", category: "armor", armorKind: "armadura", name: "Sem Armadura", spaces: 0, description: "Evasão 4 + Agilidade. Proteção = Fortitude. Espaços: 0, Engates: 0.", evasionBonus: 0, protectionBonus: 0, activeEvasion: 1, activeProtection: 0, equipped: true },
    ];
  }

  function normalizeEquipment(items, initialized = false) {
    const result = Array.isArray(items) ? items.filter((item) => item && typeof item === "object").map((item) => {
      const category = ["weapon", "armor", "supply"].includes(item.category) ? item.category : "supply";
      const int = (value) => Number.isFinite(Number.parseInt(value, 10)) ? Math.max(-999, Math.min(999, Number.parseInt(value, 10))) : 0;
      const normalized = {
        id: typeof item.id === "string" && item.id ? item.id : createId("item"),
        defaultEquipmentKey: ["punch", "no-armor"].includes(item.defaultEquipmentKey) ? item.defaultEquipmentKey : "",
        category, name: String(item.name ?? "").slice(0, 140), spaces: nonNegative(item.spaces, category === "supply" ? 1 : 0),
        description: String(item.description ?? "").slice(0, 4000),
        uses: item.uses === "" || item.uses === null || item.uses === undefined ? "" : String(nonNegative(item.uses, 0)),
        weaponClass: item.weaponClass === "Marcial" ? "Marcial" : "Simples", skill: item.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples",
        damage: String(item.damage ?? "").slice(0, 100), critical: String(item.critical ?? "").slice(0, 30),
        armorKind: item.armorKind === "escudo" ? "escudo" : "armadura", equipped: Boolean(item.equipped),
        evasionBonus: int(item.evasionBonus), protectionBonus: int(item.protectionBonus), activeEvasion: int(item.activeEvasion), activeProtection: int(item.activeProtection),
        reactionEvasion: int(item.reactionEvasion), reactionProtection: int(item.reactionProtection), reactionActive: Boolean(item.reactionActive),
      };
      if (category !== "armor") normalized.equipped = true;
      if (category !== "weapon") normalized.reactionActive = false;
      if (category !== "supply") normalized.uses = "";
      if (!normalized.defaultEquipmentKey && normalized.name.trim().toLowerCase() === "punho" && category === "weapon") normalized.defaultEquipmentKey = "punch";
      if (!normalized.defaultEquipmentKey && normalized.name.trim().toLowerCase() === "sem armadura" && category === "armor") normalized.defaultEquipmentKey = "no-armor";
      return normalized;
    }) : [];
    if (!initialized) {
      for (const item of makeDefaultEquipment()) if (!result.some((existing) => existing.defaultEquipmentKey === item.defaultEquipmentKey)) result.push(item);
    }
    return result;
  }

  function calcDefenses(skills = [], inventory = [], defenseActive = false) {
    const rank = (id) => rankValue(skills.find((skill) => skill.id === id)?.rank ?? 1);
    const armor = inventory.filter((item) => item.category === "armor" && item.equipped);
    const weapons = inventory.filter((item) => item.category === "weapon" && item.reactionActive);
    return {
      evasion: 4 + rank("agilidade") + armor.reduce((sum, item) => sum + item.evasionBonus + (defenseActive ? item.activeEvasion : 0), 0) + weapons.reduce((sum, item) => sum + item.reactionEvasion, 0),
      protection: rank("fortitude") + armor.reduce((sum, item) => sum + item.protectionBonus + (defenseActive ? item.activeProtection : 0), 0) + weapons.reduce((sum, item) => sum + item.reactionProtection, 0),
      conviction: rank("vontade"),
    };
  }

  function normalizeSheet(raw = {}) {
    const rawSkills = Array.isArray(raw.skills) ? raw.skills : [];
    const skillsMap = new Map(rawSkills.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
    const normalizeItems = (items, prefix, fields) => Array.isArray(items) ? items.filter((item) => item && typeof item === "object").map((item) => {
      const normalized = { id: typeof item.id === "string" && item.id ? item.id : createId(prefix) };
      for (const [key, limit] of Object.entries(fields)) normalized[key] = String(item[key] ?? "").slice(0, limit);
      return normalized;
    }) : [];
    const normalizeAbilities = (items) => normalizeItems(items, "ability", { name: 140, traits: 500, description: 6000 });
    const normalizeProfiles = (items, prefix) => normalizeItems(items, prefix, { name: 140, description: 6000 });
    const skills = ALL_SKILLS.map((skill) => ({ ...skill, rank: rankValue(skillsMap.get(skill.id)?.rank ?? 1) }));
    const defenseActive = Boolean(raw.defenseActive);
    const inventory = normalizeEquipment(raw.inventory, Boolean(raw.equipmentDefaultsInitialized));
    const normalized = {
      characterName: String(raw.characterName ?? "Personagem").trim() || "Personagem",
      characterClass: String(raw.characterClass ?? ""), organization: String(raw.organization ?? ""),
      occupation: String(raw.occupation ?? "").trim().slice(0, 100), evolution: nonNegative(raw.evolution, 1, 100),
      resourceOneNormal: nonNegative(raw.resourceOneNormal ?? raw.resourceOneCurrent, 0), resourceOneChronic: nonNegative(raw.resourceOneChronic, 0),
      resourceOneUnconscious: nonNegative(raw.resourceOneUnconsciousAt ?? raw.resourceOneUnconscious ?? raw.resourceOneMax, 10),
      resourceOneHurtAt: Math.max(1, nonNegative(raw.resourceOneHurtAt, 5)), resourceOneDeadAt: Math.max(1, nonNegative(raw.resourceOneDeadAt, 20)),
      resourceTwoNormal: nonNegative(raw.resourceTwoNormal ?? raw.resourceTwoCurrent, 0), resourceTwoChronic: nonNegative(raw.resourceTwoChronic, 0),
      resourceTwoUnconscious: nonNegative(raw.resourceTwoLosingMindAt ?? raw.resourceTwoUnconsciousAt ?? raw.resourceTwoUnconscious ?? raw.resourceTwoMax, 10),
      resourceTwoStressedAt: Math.max(1, nonNegative(raw.resourceTwoStressedAt, 5)), resourceTwoInsaneAt: Math.max(1, nonNegative(raw.resourceTwoInsaneAt, 20)),
      hideFromPlayers: Boolean(raw.hideFromPlayers), showTokenName: raw.showTokenName !== false,
      nameAppearance: raw.nameAppearance && typeof raw.nameAppearance === "object" ? raw.nameAppearance : null,
      skills, inventorySpaces: nonNegative(raw.inventorySpaces ?? raw.inventoryMaxSpaces, 0), inventory, equipmentDefaultsInitialized: true, defenseActive,
      powers: normalizeAbilities(raw.powers), rituals: normalizeAbilities(raw.rituals),
      parameters: normalizeProfiles(raw.parameters, "parameter"), traumas: normalizeProfiles(raw.traumas, "trauma"), history: String(raw.history ?? "").slice(0, 16000),
    };
    return { ...normalized, ...calcDefenses(skills, inventory, defenseActive) };
  }

  function normalizeNameAppearance(raw = {}, fallback = {}) {
    const source = { ...(fallback && typeof fallback === "object" ? fallback : {}), ...(raw && typeof raw === "object" ? raw : {}) };
    const rawPercent = Number(source.nameSizePercent);
    const allowedFonts = ["sans-serif", "Arial", "serif", "Georgia", "Times New Roman", "monospace", "Courier New", "cursive"];
    return {
      nameSizePercent: Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : (source.nameSize === "small" ? 35 : 0),
      nameAlignment: ["left", "center", "right"].includes(source.nameAlignment) ? source.nameAlignment : "center",
      nameColor: /^#[0-9a-f]{6}$/i.test(String(source.nameColor ?? "")) ? String(source.nameColor).toLowerCase() : "#000000",
      nameFont: allowedFonts.includes(source.nameFont) ? source.nameFont : "serif",
    };
  }

  function updateResourceTrackerVisuals() {
    const read = (id, fallback = 0) => nonNegative(byId(id)?.value, fallback);
    const woundsNormal = read("resource-one-normal");
    const woundsChronic = read("resource-one-chronic");
    const wounds = woundsNormal + woundsChronic;
    const woundsHurt = Math.max(1, read("resource-one-hurt-at", 5));
    const woundsUnconscious = Math.max(1, read("resource-one-unconscious", 10));
    const woundsDead = Math.max(woundsUnconscious + 1, read("resource-one-dead-at", 20));
    const stressNormal = read("resource-two-normal");
    const stressChronic = read("resource-two-chronic");
    const stress = stressNormal + stressChronic;
    const stressStressed = Math.max(1, read("resource-two-stressed-at", 5));
    const stressLosingMind = Math.max(1, read("resource-two-unconscious", 10));
    const stressInsane = Math.max(stressLosingMind + 1, read("resource-two-insane-at", 20));
    if (byId("sheet-wounds-current")) byId("sheet-wounds-current").textContent = `${wounds}/${woundsUnconscious}`;
    if (byId("sheet-stress-current")) byId("sheet-stress-current").textContent = `${stress}/${stressLosingMind}`;
    if (byId("sheet-wounds-fill")) byId("sheet-wounds-fill").style.width = `${Math.min(100, wounds / woundsUnconscious * 100)}%`;
    if (byId("sheet-stress-fill")) byId("sheet-stress-fill").style.width = `${Math.min(100, stress / stressLosingMind * 100)}%`;
    const marker = (id, threshold, max) => {
      const node = byId(id);
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

  function openNameAppearanceDialog() {
    const dialog = byId("name-appearance-dialog");
    if (!dialog) return;
    const appearance = normalizeNameAppearance(nameAppearance ?? {}, originalPayload?.displaySettings ?? {});
    byId("token-name-size").value = String(appearance.nameSizePercent);
    byId("token-name-size-value").textContent = `${appearance.nameSizePercent}%`;
    byId("token-name-alignment").value = appearance.nameAlignment;
    byId("token-name-color").value = appearance.nameColor;
    byId("token-name-font").value = appearance.nameFont;
    byId("token-name-visible").checked = showTokenName;
    const description = dialog.querySelector("p");
    if (description) description.textContent = "As opções serão aplicadas ao token quando você importar a ficha atualizada no Owlbear Rodeo.";
    dialog.showModal();
  }

  function saveNameAppearance() {
    nameAppearance = normalizeNameAppearance({
      nameSizePercent: Number.parseInt(byId("token-name-size").value, 10) || 0,
      nameAlignment: byId("token-name-alignment").value,
      nameColor: byId("token-name-color").value,
      nameFont: byId("token-name-font").value,
    });
    showTokenName = Boolean(byId("token-name-visible").checked);
    byId("name-appearance-dialog").close();
    setNotice("Aparência do nome atualizada. Clique em Salvar para baixar o HTML com essa configuração.", "info");
  }

  function resetNameAppearanceToRoom() {
    nameAppearance = null;
    showTokenName = true;
    byId("name-appearance-dialog").close();
    setNotice("Aparência do nome restaurada às configurações da sala. Clique em Salvar para baixar o HTML atualizado.", "info");
  }

  function openResourceSettingsDialog() {
    byId("config-wounds-hurt").value = byId("resource-one-hurt-at").value || "5";
    byId("config-wounds-unconscious").value = byId("resource-one-unconscious").value || "10";
    byId("config-wounds-dead").value = byId("resource-one-dead-at").value || "20";
    byId("config-stress-stressed").value = byId("resource-two-stressed-at").value || "5";
    byId("config-stress-losing-mind").value = byId("resource-two-unconscious").value || "10";
    byId("config-stress-insane").value = byId("resource-two-insane-at").value || "20";
    resourceSettingsDraft = {
      woundsChronic: nonNegative(byId("resource-one-chronic").value),
      stressChronic: nonNegative(byId("resource-two-chronic").value),
    };
    byId("config-wounds-chronic-value").textContent = String(resourceSettingsDraft.woundsChronic);
    byId("config-stress-chronic-value").textContent = String(resourceSettingsDraft.stressChronic);
    byId("resource-settings-dialog").showModal();
  }

  function saveResourceSettings() {
    const mappings = [
      ["resource-one-hurt-at", "config-wounds-hurt"],
      ["resource-one-unconscious", "config-wounds-unconscious"],
      ["resource-one-dead-at", "config-wounds-dead"],
      ["resource-two-stressed-at", "config-stress-stressed"],
      ["resource-two-unconscious", "config-stress-losing-mind"],
      ["resource-two-insane-at", "config-stress-insane"],
    ];
    const values = mappings.map(([, dialogId]) => Number.parseInt(byId(dialogId).value, 10));
    if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 9999)) {
      setNotice("Os limites devem ser números inteiros entre 1 e 9999.", "warning");
      return;
    }
    const [woundsHurt, woundsUnconscious, woundsDead, stressStressed, stressLosingMind, stressInsane] = values;
    if (!(woundsHurt < woundsUnconscious && woundsUnconscious < woundsDead && stressStressed < stressLosingMind && stressLosingMind < stressInsane)) {
      setNotice("Cada limite deve ser maior que o anterior: primeiro estágio, segundo estágio e limite final.", "warning");
      return;
    }
    for (let i = 0; i < mappings.length; i += 1) byId(mappings[i][0]).value = String(values[i]);
    const woundsNormal = nonNegative(byId("resource-one-normal").value);
    const stressNormal = nonNegative(byId("resource-two-normal").value);
    byId("resource-one-chronic").value = String(Math.min(resourceSettingsDraft.woundsChronic, Math.max(0, woundsDead - woundsNormal)));
    byId("resource-two-chronic").value = String(Math.min(resourceSettingsDraft.stressChronic, Math.max(0, stressInsane - stressNormal)));
    updateResourceTrackerVisuals();
    byId("resource-settings-dialog").close();
    setNotice("Limites atualizados. Clique em Salvar para baixar a ficha atualizada.", "info");
  }

  function stepResource(resourceClass, delta) {
    const wounds = resourceClass === "wounds";
    const id = wounds ? "resource-one-normal" : "resource-two-normal";
    const chronicId = wounds ? "resource-one-chronic" : "resource-two-chronic";
    const finalId = wounds ? "resource-one-dead-at" : "resource-two-insane-at";
    const normal = nonNegative(byId(id).value);
    const chronic = nonNegative(byId(chronicId).value);
    const limit = Math.max(1, nonNegative(byId(finalId).value, 20));
    const next = delta > 0 ? Math.min(normal + delta, Math.max(0, limit - chronic)) : Math.max(0, normal + delta);
    byId(id).value = String(next);
    updateResourceTrackerVisuals();
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function inlineMarkdown(source) {
    let html = escapeHtml(source);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  }

  function markdownHtml(source) {
    const paragraphs = String(source ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
    return paragraphs.map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return "";
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) return `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`;
      if (/^(\s*[-*]\s+)/m.test(trimmed)) {
        const items = trimmed.split("\n").map((line) => line.match(/^\s*[-*]\s+(.+)$/)).filter(Boolean);
        if (items.length) return `<ul>${items.map((item) => `<li>${inlineMarkdown(item[1])}</li>`).join("")}</ul>`;
      }
      if (/^\s*\d+\.\s+/m.test(trimmed)) {
        const items = trimmed.split("\n").map((line) => line.match(/^\s*\d+\.\s+(.+)$/)).filter(Boolean);
        if (items.length) return `<ol>${items.map((item) => `<li>${inlineMarkdown(item[1])}</li>`).join("")}</ol>`;
      }
      return `<p>${trimmed.split("\n").map(inlineMarkdown).join("<br>")}</p>`;
    }).join("");
  }

  function updatePreview(editor) {
    const wrapper = editor.closest(".formatted-editor");
    const preview = wrapper?.querySelector(".markdown-preview");
    if (!wrapper || !preview) return;
    const value = editor.value ?? "";
    preview.classList.remove("traits-preview");
    if (editor.matches('[data-ability-field="traits"]')) {
      preview.classList.add("traits-preview");
      const traits = value.split(/[;,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
      preview.innerHTML = traits.length ? traits.map((trait) => `<span class="ability-trait">${inlineMarkdown(trait.slice(0, 80))}</span>`).join("") : `<span class="markdown-placeholder">${escapeHtml(editor.placeholder || "Clique para adicionar traços…")}</span>`;
    } else if (!value.trim()) {
      preview.innerHTML = `<span class="markdown-placeholder">${escapeHtml(editor.placeholder || "Clique para editar…")}</span>`;
    } else {
      preview.innerHTML = markdownHtml(value);
    }
    if (wrapper.dataset.replaceMode === "true") {
      editor.hidden = true;
      preview.hidden = false;
      wrapper.classList.add("is-preview-mode");
    } else {
      const hasMarkdown = /(?:\*\*|\*|~~|`|\[[^\]]+\]\(https?:\/\/|^#{1,3}\s|^\s*[-*]\s)/m.test(value);
      preview.hidden = !hasMarkdown;
      if (!hasMarkdown) preview.replaceChildren();
    }
  }

  function makeFormattedEditor(editor) {
    const wrapper = document.createElement("div");
    wrapper.className = "formatted-editor";
    const replaceMode = editor.dataset.formatReplace === "true";
    if (replaceMode) wrapper.dataset.replaceMode = "true";
    editor.dataset.markdownEditor = "true";
    const preview = document.createElement("div");
    preview.className = "markdown-preview";
    preview.hidden = replaceMode;
    preview.tabIndex = replaceMode ? 0 : -1;
    preview.setAttribute("aria-label", replaceMode ? "Conteúdo formatado. Clique para editar." : "Prévia da formatação");
    wrapper.append(editor, preview);
    if (replaceMode) updatePreview(editor);
    return wrapper;
  }

  function attachStaticEditors() {
    for (const editor of [...form.querySelectorAll('input[type="text"], textarea')]) {
      if (editor.dataset.identityPreviewField === "true" || editor.closest("#equipment-dialog, #weapon-attack-dialog") || editor.closest(".formatted-editor")) continue;
      if (editor instanceof HTMLTextAreaElement) editor.dataset.formatReplace = "true";
      const parent = editor.parentNode;
      const nextSibling = editor.nextSibling;
      const wrapper = makeFormattedEditor(editor);
      parent.insertBefore(wrapper, nextSibling);
    }
  }

  function createInput(value, { type = "text", placeholder = "", maxLength, min, max, dataset = {}, className = "", replace = false } = {}) {
    const input = document.createElement("input");
    input.type = type; input.value = value ?? ""; input.placeholder = placeholder; input.className = className; input.autocomplete = "off";
    if (Number.isFinite(maxLength)) input.maxLength = maxLength;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    Object.assign(input.dataset, dataset);
    if (type === "text") input.dataset.markdownEditor = "true";
    if (replace) input.dataset.formatReplace = "true";
    if (type === "text") {
      const wrapper = document.createElement("div");
      wrapper.className = "formatted-editor";
      if (replace) wrapper.dataset.replaceMode = "true";
      const preview = document.createElement("div");
      preview.className = "markdown-preview"; preview.hidden = !replace; preview.tabIndex = replace ? 0 : -1;
      preview.setAttribute("aria-label", replace ? "Conteúdo formatado. Clique para editar." : "Prévia da formatação");
      wrapper.append(input, preview);
      if (replace) updatePreview(input);
      wrapper._editor = input;
      return wrapper;
    }
    return input;
  }

  function createTextarea(value, { placeholder = "", rows = 3, maxLength = 6000, dataset = {} } = {}) {
    const textarea = document.createElement("textarea");
    textarea.value = value ?? ""; textarea.placeholder = placeholder; textarea.rows = rows; textarea.maxLength = maxLength;
    Object.assign(textarea.dataset, dataset); textarea.dataset.markdownEditor = "true"; textarea.dataset.formatReplace = "true";
    return makeFormattedEditor(textarea);
  }

  function smallButton(label, className, dataAction, title) {
    const button = document.createElement("button"); button.type = "button"; button.className = className;
    button.textContent = label; button.dataset[dataAction] = "true"; if (title) button.title = title; return button;
  }

  function makeField(labelText, editor, extraClass = "") {
    const label = document.createElement("label"); label.className = `field entry-field ${extraClass}`.trim();
    const title = document.createElement("span"); title.textContent = labelText; label.append(title, editor); return label;
  }

  function renderSkills(skills) {
    const saved = new Map(skills.map((skill) => [skill.id, rankValue(skill.rank)]));
    const fragment = document.createDocumentFragment();
    for (const group of SKILL_GROUPS) {
      const section = document.createElement("section"); section.className = "skill-group";
      const heading = document.createElement("div"); heading.className = "skill-group-heading";
      const title = document.createElement("h3"); title.className = "skill-group-title collapsible-heading-toggle"; title.textContent = group.name;
      title.dataset.collapseTarget = `standalone-skill-${group.skills[0].id}`; title.setAttribute("role", "button"); title.setAttribute("tabindex", "0"); title.setAttribute("aria-expanded", "true"); title.setAttribute("aria-controls", title.dataset.collapseTarget);
      heading.append(title); section.append(heading);
      const content = document.createElement("div"); content.className = "skill-group-content collapsible-content"; content.id = title.dataset.collapseTarget;
      for (const skill of group.skills) {
        const row = document.createElement("div"); row.className = "skill-row";
        const name = document.createElement("span"); name.className = "skill-roll-button"; name.textContent = skill.name; name.title = skill.name;
        const select = document.createElement("select"); select.className = "skill-rank"; select.dataset.skillRank = skill.id; select.setAttribute("aria-label", `Treinamento em ${skill.name}`);
        for (let rank = 1; rank <= 5; rank += 1) { const option = document.createElement("option"); option.value = String(rank); option.textContent = ROMAN_BY_RANK[rank]; option.selected = rank === (saved.get(skill.id) ?? 1); select.append(option); }
        row.append(name, select); content.append(row);
      }
      section.append(content); fragment.append(section);
    }
    byId("skills-list").replaceChildren(fragment);
  }

  function updateDefenseDisplay(sheet = null) {
    const source = sheet ?? { skills: readSheetFromForm().skills, inventory: readEquipmentList(), defenseActive: defenseActiveDraft };
    const values = calcDefenses(source.skills, source.inventory, source.defenseActive);
    for (const [key, output, input] of [["evasion", "defense-evasion-value", "character-evasion"], ["protection", "defense-protection-value", "character-protection"], ["conviction", "defense-conviction-value", "character-conviction"]]) {
      if (byId(output)) byId(output).textContent = String(values[key]);
      if (byId(input)) byId(input).value = String(values[key]);
    }
    const button = byId("defense-active-toggle");
    const status = byId("defense-active-status");
    if (button) {
      button.classList.toggle("is-active", Boolean(source.defenseActive));
      button.setAttribute("aria-pressed", String(Boolean(source.defenseActive)));
      button.textContent = source.defenseActive ? "Defesa Ativa · Desativar" : "Defesa Ativa";
    }
    if (status) {
      const armor = source.inventory.filter((item) => item.category === "armor" && item.equipped);
      const eva = source.defenseActive ? armor.reduce((sum, item) => sum + item.activeEvasion, 0) : 0;
      const pro = source.defenseActive ? armor.reduce((sum, item) => sum + item.activeProtection, 0) : 0;
      status.hidden = !source.defenseActive;
      status.textContent = `Bônus ativos: EVA ${eva >= 0 ? "+" : ""}${eva} · PRO ${pro >= 0 ? "+" : ""}${pro}`;
    }
  }

  function renderInventory(items) {
    const normalized = normalizeEquipment(items, true);
    const lists = { weapon: byId("weapons-list"), armor: byId("armor-list"), supply: byId("supplies-list") };
    for (const [category, container] of Object.entries(lists)) {
      if (!container) continue;
      const fragment = document.createDocumentFragment();
      const matches = normalized.filter((item) => item.category === category);
      if (!matches.length) {
        const empty = document.createElement("p"); empty.className = "empty-state equipment-empty-state";
        empty.textContent = category === "weapon" ? "Nenhuma arma." : category === "armor" ? "Nenhuma armadura ou escudo." : "Nenhum suprimento.";
        fragment.append(empty);
      }
      for (const item of matches) {
        const card = document.createElement("article"); card.className = `equipment-card equipment-card-${category}`;
        card.dataset.inventoryCard = "true"; card.dataset.inventoryId = item.id; card.dataset.inventoryCategory = category; card._equipmentData = { ...item };
        const spaces = document.createElement("input"); spaces.type = "hidden"; spaces.dataset.inventoryField = "spaces"; spaces.value = String(item.spaces);
        const main = document.createElement("button"); main.type = "button"; main.className = "equipment-card-main"; main.dataset.equipmentAction = "edit";
        const title = document.createElement("span"); title.className = "equipment-card-title"; title.textContent = item.name || "Novo item";
        const meta = document.createElement("span"); meta.className = "equipment-card-meta";
        if (category === "weapon") {
          const reaction = item.reactionEvasion || item.reactionProtection ? ` · Reação EVA ${item.reactionEvasion >= 0 ? "+" : ""}${item.reactionEvasion} · PRO ${item.reactionProtection >= 0 ? "+" : ""}${item.reactionProtection}` : "";
          meta.textContent = `${item.weaponClass} · ${item.skill === "armas-de-fogo" ? "Armas de Fogo" : "Armas Simples"} · Dano ${item.damage || "—"} · Críticos ${item.critical || "—"}${reaction}`;
        } else if (category === "armor") meta.textContent = item.defaultEquipmentKey === "no-armor" ? "Evasão 4 + Agilidade · Proteção Fortitude · Defesa ativa EVA +1" : `${item.armorKind === "escudo" ? "Escudo" : "Armadura"} · EVA ${item.evasionBonus >= 0 ? "+" : ""}${item.evasionBonus} · PRO ${item.protectionBonus >= 0 ? "+" : ""}${item.protectionBonus} · Defesa ativa EVA ${item.activeEvasion >= 0 ? "+" : ""}${item.activeEvasion} · PRO ${item.activeProtection >= 0 ? "+" : ""}${item.activeProtection}${item.equipped ? " · Em uso" : ""}`;
        else meta.textContent = item.description || "";
        main.append(title, meta);
        const actions = document.createElement("div"); actions.className = "equipment-card-actions";
        const addAction = (label, action, className = "equipment-action-button") => { const button = smallButton(label, className, "equipmentAction"); button.dataset.equipmentAction = action; actions.append(button); return button; };
        if (category === "weapon") {
          addAction("Atacar", "attack", "equipment-action-button equipment-attack-button");
          if (item.reactionEvasion || item.reactionProtection) addAction(item.reactionActive ? "Reação ativa" : "Reagir", "reaction");
        } else if (category === "armor") {
          if (item.defaultEquipmentKey === "no-armor") { const badge = document.createElement("span"); badge.className = "equipment-state-badge"; badge.textContent = "Padrão"; actions.append(badge); }
          else addAction(item.equipped ? "Em uso" : "Equipar", "toggle-equipped", `equipment-action-button ${item.equipped ? "is-equipped" : ""}`);
        }
        else if (String(item.uses ?? "").trim() !== "") {
          addAction("−", "uses-down", "equipment-uses-step"); const count = document.createElement("output"); count.className = "equipment-uses-count"; count.textContent = item.uses; actions.append(count); addAction("+", "uses-up", "equipment-uses-step");
        }
        const remove = smallButton("×", "remove-entry-button remove-icon-button equipment-remove-button", "removeInventory", "Remover item"); actions.append(remove);
        card.append(spaces, main, actions); fragment.append(card);
      }
      container.replaceChildren(fragment);
    }
    updateInventorySpaceTotal();
    updateDefenseDisplay();
  }

  function readEquipmentList() {
    return [...byId("inventory-list").querySelectorAll("[data-inventory-card]")].map((card) => {
      const item = card._equipmentData ?? {};
      const spaces = card.querySelector('[data-inventory-field="spaces"]');
      return { ...item, id: card.dataset.inventoryId || item.id || createId("item"), spaces: spaces ? nonNegative(spaces.value, 0) : nonNegative(item.spaces, 0) };
    });
  }

  function openEquipmentEditor(category, item, { isNew = false } = {}) {
    if (!item) return;
    editingEquipmentId = item.id; editingEquipmentCategory = category; editingEquipmentIsNew = isNew;
    byId("equipment-dialog-title").textContent = category === "weapon" ? "Arma" : category === "armor" ? "Armadura ou escudo" : "Suprimento";
    byId("equipment-name").value = item.name ?? ""; byId("equipment-spaces").value = String(item.spaces ?? (category === "supply" ? 1 : 0));
    byId("equipment-description").value = item.description ?? "";
    byId("weapon-editor-fields").hidden = category !== "weapon"; byId("armor-editor-fields").hidden = category !== "armor"; byId("supply-editor-fields").hidden = category !== "supply";
    byId("equipment-weapon-class").value = item.weaponClass === "Marcial" ? "Marcial" : "Simples";
    byId("equipment-weapon-skill").value = item.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples";
    byId("equipment-damage").value = item.damage ?? ""; byId("equipment-critical").value = item.critical ?? "";
    byId("equipment-reaction-evasion").value = String(item.reactionEvasion ?? 0); byId("equipment-reaction-protection").value = String(item.reactionProtection ?? 0);
    byId("equipment-armor-kind").value = item.armorKind === "escudo" ? "escudo" : "armadura"; byId("equipment-equipped").checked = Boolean(item.equipped);
    byId("equipment-evasion-bonus").value = String(item.evasionBonus ?? 0); byId("equipment-protection-bonus").value = String(item.protectionBonus ?? 0);
    byId("equipment-active-evasion").value = String(item.activeEvasion ?? 0); byId("equipment-active-protection").value = String(item.activeProtection ?? 0);
    byId("equipment-uses").value = item.uses === "" || item.uses === null || item.uses === undefined ? "" : String(item.uses);
    byId("equipment-dialog").showModal(); byId("equipment-name").focus();
  }

  function addEquipment(category) {
    const sheet = readSheetFromForm();
    const item = category === "weapon"
      ? { id: createId("item"), category, name: "", spaces: 0, weaponClass: "Simples", skill: "armas-simples", damage: "", critical: "", reactionEvasion: 0, reactionProtection: 0, description: "" }
      : category === "armor"
        ? { id: createId("item"), category, name: "", spaces: 0, armorKind: "armadura", equipped: false, evasionBonus: 0, protectionBonus: 0, activeEvasion: 0, activeProtection: 0, description: "" }
        : { id: createId("item"), category: "supply", name: "", spaces: 1, uses: "", description: "" };
    sheet.inventory.push(item); renderInventory(sheet.inventory); openEquipmentEditor(category, item, { isNew: true });
  }

  function saveEquipmentEditor() {
    const name = byId("equipment-name").value.trim();
    if (!name) { setNotice("Informe o nome do equipamento.", "error"); byId("equipment-name").focus(); return; }
    if (editingEquipmentCategory === "weapon" && (!byId("equipment-damage").value.trim() || byId("equipment-critical").value.trim() === "")) { setNotice("Preencha Dano e Críticos da arma.", "error"); return; }
    const entries = readEquipmentList();
    const current = entries.find((item) => item.id === editingEquipmentId); if (!current) return;
    const item = { ...current, name: name.slice(0, 140), spaces: nonNegative(byId("equipment-spaces").value, 0), description: byId("equipment-description").value.slice(0, 4000) };
    if (editingEquipmentCategory === "weapon") Object.assign(item, {
      weaponClass: byId("equipment-weapon-class").value === "Marcial" ? "Marcial" : "Simples",
      skill: byId("equipment-weapon-skill").value === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples",
      damage: byId("equipment-damage").value.trim(), critical: String(nonNegative(byId("equipment-critical").value, 0, 99)),
      reactionEvasion: Number.parseInt(byId("equipment-reaction-evasion").value, 10) || 0, reactionProtection: Number.parseInt(byId("equipment-reaction-protection").value, 10) || 0,
    });
    if (editingEquipmentCategory === "armor") {
      item.armorKind = byId("equipment-armor-kind").value === "escudo" ? "escudo" : "armadura"; item.equipped = byId("equipment-equipped").checked;
      item.evasionBonus = Number.parseInt(byId("equipment-evasion-bonus").value, 10) || 0; item.protectionBonus = Number.parseInt(byId("equipment-protection-bonus").value, 10) || 0;
      item.activeEvasion = Number.parseInt(byId("equipment-active-evasion").value, 10) || 0; item.activeProtection = Number.parseInt(byId("equipment-active-protection").value, 10) || 0;
      if (item.equipped && item.armorKind !== "escudo") for (const other of entries) if (other.id !== item.id && other.category === "armor" && other.armorKind !== "escudo") other.equipped = false;
    }
    if (editingEquipmentCategory === "supply") item.uses = String(byId("equipment-uses").value).trim() === "" ? "" : String(nonNegative(byId("equipment-uses").value, 0));
    const next = entries.map((entry) => entry.id === item.id ? item : entry);
    if (item.category === "armor" && item.equipped && item.armorKind !== "escudo") for (const other of next) if (other.id !== item.id && other.category === "armor" && other.armorKind !== "escudo") other.equipped = false;
    if (item.category === "armor") {
      const hasBodyArmor = next.some((entry) => entry.category === "armor" && entry.armorKind !== "escudo" && entry.equipped && entry.defaultEquipmentKey !== "no-armor");
      for (const entry of next) if (entry.defaultEquipmentKey === "no-armor") entry.equipped = !hasBodyArmor;
    }
    renderInventory(next); editingEquipmentIsNew = false; byId("equipment-dialog").close(); setNotice("Equipamento atualizado. Clique em Salvar para exportar a ficha.", "info");
  }

  function cancelEquipmentEditor() {
    if (editingEquipmentIsNew && editingEquipmentId) renderInventory(readEquipmentList().filter((item) => item.id !== editingEquipmentId));
    editingEquipmentIsNew = false; editingEquipmentId = null;
    if (byId("equipment-dialog").open) byId("equipment-dialog").close();
  }

  function modifyEquipment(card, action) {
    if (!card?._equipmentData) return;
    const entries = readEquipmentList(); const item = entries.find((entry) => entry.id === card.dataset.inventoryId); if (!item) return;
    if (action === "toggle-equipped") {
      if (item.defaultEquipmentKey === "no-armor") return;
      item.equipped = !item.equipped;
      if (item.equipped && item.armorKind !== "escudo") for (const other of entries) if (other.id !== item.id && other.category === "armor" && other.armorKind !== "escudo") other.equipped = false;
      const hasBodyArmor = entries.some((entry) => entry.category === "armor" && entry.armorKind !== "escudo" && entry.equipped && entry.defaultEquipmentKey !== "no-armor");
      for (const entry of entries) if (entry.defaultEquipmentKey === "no-armor") entry.equipped = !hasBodyArmor;
    } else if (action === "reaction") item.reactionActive = !item.reactionActive;
    else if (action === "uses-down" || action === "uses-up") {
      if (String(item.uses ?? "").trim() === "") return;
      item.uses = String(Math.max(0, Math.min(9999, Number.parseInt(item.uses, 10) + (action === "uses-up" ? 1 : -1))));
    } else if (action === "remove") {
      renderInventory(entries.filter((entry) => entry.id !== item.id)); return;
    }
    renderInventory(entries);
  }

  function attackWeapon(item) {
    if (!item) return;
    attackingWeaponId = item.id; byId("weapon-attack-title").textContent = `Atacar com ${item.name || "arma"}`;
    byId("weapon-attack-dt").value = ""; byId("weapon-attack-preview").hidden = true;
    byId("weapon-attack-dialog").showModal(); byId("weapon-attack-dt").focus();
  }

  function runStandaloneAttack() {
    const dt = Number(byId("weapon-attack-dt").value);
    if (byId("weapon-attack-dt").value.trim() === "" || !Number.isInteger(dt) || dt < 0) { setNotice("Informe a DT do alvo.", "error"); return; }
    const sheet = readSheetFromForm(); const weapon = sheet.inventory.find((item) => item.id === attackingWeaponId);
    if (!weapon) return;
    const skillId = weapon.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples";
    const rank = rankValue(sheet.skills.find((skill) => skill.id === skillId)?.rank ?? 1);
    const dice = Array.from({ length: rank }, () => Math.floor(Math.random() * 10) + 1).sort((a, b) => b - a);
    const criticals = dice.filter((die, index) => die === 10 || (index > 0 && die >= dt)).length;
    const result = dice[0] + criticals; const success = result >= dt;
    const strength = rankValue(sheet.skills.find((skill) => skill.id === "forca")?.rank ?? 1);
    let base = 0; const damageRolls = [];
    const expression = String(weapon.damage ?? "").replace(/força/gi, String(strength));
    const terms = expression.match(/[+-]?\s*(?:\d*d\d+|\d+)/gi) ?? [];
    if (terms.join("").replace(/\s/g, "") !== expression.replace(/\s/g, "")) { setNotice("Dano inválido. Use Força, um número ou dados como 1d6+2.", "error"); return; }
    for (const term of terms) {
      const sign = term.trim().startsWith("-") ? -1 : 1; const atom = term.replace(/[+-]/g, "").trim(); const match = atom.match(/^(\d*)d(\d+)$/i);
      if (match) { const count = Number(match[1] || 1); const sides = Number(match[2]); if (count < 1 || count > 20 || sides < 2 || sides > 1000) { setNotice("Expressão de dano fora dos limites.", "error"); return; } for (let index = 0; index < count; index += 1) { const value = Math.floor(Math.random() * sides) + 1; base += sign * value; damageRolls.push(value); } }
      else base += sign * Number(atom);
    }
    const bonus = Number.parseInt(weapon.critical, 10) || 0; const damage = success ? Math.max(0, base + criticals * bonus) : 0;
    const message = `${sheet.characterName}: ${weapon.name} · ${dice.join(", ")} · DT ${dt} · Resultado ${result} (${success ? "acerto" : "falha"}) · Críticos ${criticals} · Dano ${damage}${damageRolls.length ? ` [${damageRolls.join(", ")}]` : ""}. No HTML independente, o ataque é apenas simulado e não é enviado ao chat do Owlbear.`;
    byId("weapon-attack-preview").textContent = message; byId("weapon-attack-preview").hidden = false;
    setNotice(message, success ? "info" : "error"); byId("weapon-attack-dialog").close();
  }

  function renderAbilities(container, abilities, kind) {
    const fragment = document.createDocumentFragment();
    if (!abilities.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = kind === "power" ? "Nenhum poder cadastrado." : "Nenhum ritual cadastrado."; fragment.append(empty); }
    for (const ability of abilities) {
      const card = document.createElement("article"); card.className = "ability-entry"; card.dataset.abilityCard = "true"; card.dataset.abilityId = ability.id; card.dataset.abilityKind = kind;
      const top = document.createElement("div"); top.className = "ability-entry-top";
      const name = createInput(ability.name, { placeholder: kind === "power" ? "Nome do poder" : "Nome do ritual", maxLength: 140, dataset: { abilityField: "name" }, className: "ability-name-input", replace: true }); name.querySelector("input").setAttribute("aria-label", kind === "power" ? "Nome do poder" : "Nome do ritual");
      const actions = document.createElement("div"); actions.className = "ability-entry-actions";
      const remove = smallButton("×", "remove-entry-button remove-icon-button", "removeAbility", `Remover ${kind === "power" ? "poder" : "ritual"}`); remove.setAttribute("aria-label", "Remover entrada"); actions.append(remove); top.append(name, actions);
      const traits = createInput(ability.traits, { placeholder: "Ação, Visual, Teste Mental", maxLength: 500, dataset: { abilityField: "traits" }, replace: true }); traits.querySelector("input").setAttribute("aria-label", "Traços da habilidade");
      const description = createTextarea(ability.description, { placeholder: "Descrição da habilidade…", rows: 4, maxLength: 6000, dataset: { abilityField: "description" } }); description.querySelector("textarea").className = "ability-description-input"; description.querySelector("textarea").setAttribute("aria-label", "Descrição da habilidade");
      card.append(top, makeField("Traços", traits, "ability-traits-field"), makeField("Descrição", description, "ability-description-field")); fragment.append(card);
    }
    container.replaceChildren(fragment);
  }

  function renderProfiles(container, entries, kind) {
    const fragment = document.createDocumentFragment(); const title = kind === "parameter" ? "parâmetro" : "trauma";
    if (!entries.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = kind === "parameter" ? "Nenhum parâmetro cadastrado." : "Nenhum trauma cadastrado."; fragment.append(empty); }
    for (const entry of entries) {
      const card = document.createElement("article"); card.className = "profile-entry"; card.dataset.profileCard = "true"; card.dataset.profileId = entry.id; card.dataset.profileKind = kind;
      const top = document.createElement("div"); top.className = "profile-entry-top";
      const name = createInput(entry.name, { placeholder: `Nome ${kind === "parameter" ? "do parâmetro" : "do trauma"}`, maxLength: 140, dataset: { profileField: "name" }, replace: true }); name.querySelector("input").setAttribute("aria-label", `Nome ${title}`);
      const remove = smallButton("×", "remove-entry-button remove-icon-button", "removeProfileEntry", `Remover ${title}`); remove.setAttribute("aria-label", `Remover ${title}`); top.append(name, remove);
      const description = createTextarea(entry.description, { placeholder: `Descrição do ${title}…`, rows: 4, maxLength: 6000, dataset: { profileField: "description" } }); description.querySelector("textarea").setAttribute("aria-label", `Descrição do ${title}`);
      card.append(top, makeField("Descrição", description, "profile-description-field")); fragment.append(card);
    }
    container.replaceChildren(fragment);
  }

  function renderEntryLists(sheet) {
    renderInventory(sheet.inventory); renderAbilities(byId("powers-list"), sheet.powers, "power");
    renderAbilities(byId("rituals-list"), sheet.rituals, "ritual");
    renderProfiles(byId("parameters-list"), sheet.parameters, "parameter"); renderProfiles(byId("traumas-list"), sheet.traumas, "trauma");
  }

  function renderToForm(sheet) {
    nameAppearance = sheet.nameAppearance && typeof sheet.nameAppearance === "object" ? { ...sheet.nameAppearance } : null;
    showTokenName = sheet.showTokenName !== false;
    const values = {
      "character-name": sheet.characterName, "character-class": sheet.characterClass, "character-organization": sheet.organization,
      "character-occupation": sheet.occupation, "character-evolution": sheet.evolution,
      "resource-one-normal": sheet.resourceOneNormal, "resource-one-chronic": sheet.resourceOneChronic,
      "resource-one-unconscious": sheet.resourceOneUnconscious, "resource-one-hurt-at": sheet.resourceOneHurtAt,
      "resource-one-dead-at": sheet.resourceOneDeadAt, "resource-two-normal": sheet.resourceTwoNormal,
      "resource-two-chronic": sheet.resourceTwoChronic, "resource-two-unconscious": sheet.resourceTwoUnconscious,
      "resource-two-stressed-at": sheet.resourceTwoStressedAt, "resource-two-insane-at": sheet.resourceTwoInsaneAt,
      "character-evasion": sheet.evasion, "character-protection": sheet.protection, "character-conviction": sheet.conviction,
      "inventory-spaces": sheet.inventorySpaces, "character-history": sheet.history,
    };
    for (const [id, value] of Object.entries(values)) if (byId(id)) byId(id).value = value ?? "";
    defenseActiveDraft = Boolean(sheet.defenseActive);
    renderSkills(sheet.skills); renderEntryLists(sheet); attachStaticEditors();
    updateDefenseDisplay(sheet);
    byId("selected-name").textContent = sheet.characterName;
    document.title = `${sheet.characterName} | Ficha A&A`;
    document.documentElement.dataset.aaTheme = "owlbear";
    byId("app").classList.remove("not-ready");
    updateInventorySpaceTotal();
    updateResourceTrackerVisuals();
    for (const button of form.querySelectorAll("[data-sheet-tab]")) {
      const active = button.dataset.sheetTab === "character-tab";
      button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active));
    }
    for (const panel of form.querySelectorAll("[data-sheet-panel]")) panel.hidden = panel.id !== "character-tab";
    setNotice("Ficha independente. Clique em Salvar para baixar a versão atualizada.", "info");
  }

  function readList(container, selector, mapping) {
    return [...container.querySelectorAll(selector)].map(mapping);
  }

  function readSheetFromForm() {
    const rankById = new Map([...byId("skills-list").querySelectorAll("[data-skill-rank]")].map((field) => [field.dataset.skillRank, rankValue(field.value)]));
    return normalizeSheet({
      characterName: byId("character-name").value.trim() || "Personagem",
      characterClass: byId("character-class").value, organization: byId("character-organization").value,
      occupation: byId("character-occupation").value.trim(), evolution: nonNegative(byId("character-evolution").value, 1, 100),
      resourceOneNormal: nonNegative(byId("resource-one-normal").value), resourceOneChronic: nonNegative(byId("resource-one-chronic").value),
      resourceOneUnconscious: nonNegative(byId("resource-one-unconscious").value, 10), resourceOneHurtAt: Math.max(1, nonNegative(byId("resource-one-hurt-at").value, 5)),
      resourceOneDeadAt: Math.max(1, nonNegative(byId("resource-one-dead-at").value, 20)), resourceTwoNormal: nonNegative(byId("resource-two-normal").value),
      resourceTwoChronic: nonNegative(byId("resource-two-chronic").value), resourceTwoUnconscious: nonNegative(byId("resource-two-unconscious").value, 10),
      resourceTwoStressedAt: Math.max(1, nonNegative(byId("resource-two-stressed-at").value, 5)), resourceTwoInsaneAt: Math.max(1, nonNegative(byId("resource-two-insane-at").value, 20)),
      evasion: optionalNumber(byId("character-evasion").value), protection: optionalNumber(byId("character-protection").value), conviction: optionalNumber(byId("character-conviction").value),
      defenseActive: defenseActiveDraft, equipmentDefaultsInitialized: true,
      hideFromPlayers: Boolean(originalPayload?.sheet?.hideFromPlayers), showTokenName,
      nameAppearance: nameAppearance && typeof nameAppearance === "object" ? nameAppearance : null,
      skills: ALL_SKILLS.map((skill) => ({ ...skill, rank: rankById.get(skill.id) ?? 1 })),
      inventorySpaces: nonNegative(byId("inventory-spaces").value), inventory: readEquipmentList(),
      powers: readList(byId("powers-list"), "[data-ability-card]", (card) => ({
        id: card.dataset.abilityId || createId("ability"), name: card.querySelector('[data-ability-field="name"]').value.trim().slice(0, 140),
        traits: card.querySelector('[data-ability-field="traits"]').value.trim().slice(0, 500), description: card.querySelector('[data-ability-field="description"]').value.slice(0, 6000),
      })),
      rituals: readList(byId("rituals-list"), "[data-ability-card]", (card) => ({
        id: card.dataset.abilityId || createId("ability"), name: card.querySelector('[data-ability-field="name"]').value.trim().slice(0, 140),
        traits: card.querySelector('[data-ability-field="traits"]').value.trim().slice(0, 500), description: card.querySelector('[data-ability-field="description"]').value.slice(0, 6000),
      })),
      parameters: readList(byId("parameters-list"), "[data-profile-card]", (card) => ({
        id: card.dataset.profileId || createId("parameter"), name: card.querySelector('[data-profile-field="name"]').value.trim().slice(0, 140), description: card.querySelector('[data-profile-field="description"]').value.slice(0, 6000),
      })),
      traumas: readList(byId("traumas-list"), "[data-profile-card]", (card) => ({
        id: card.dataset.profileId || createId("trauma"), name: card.querySelector('[data-profile-field="name"]').value.trim().slice(0, 140), description: card.querySelector('[data-profile-field="description"]').value.slice(0, 6000),
      })),
      history: byId("character-history").value.slice(0, 16000),
    });
  }

  function updateInventorySpaceTotal() {
    const total = [...byId("inventory-list").querySelectorAll("[data-inventory-card]")].reduce((sum, card) => sum + nonNegative(card.querySelector('[data-inventory-field="spaces"]')?.value, 1), 0);
    const limit = nonNegative(byId("inventory-spaces").value, 0);
    const output = byId("inventory-spaces-used");
    output.textContent = `${total}/${limit}`; output.classList.toggle("over-capacity", total > limit);
    output.setAttribute("aria-label", `${total} espaços ocupados de ${limit} disponíveis`);
  }

  function sanitizeFilename(value) {
    return String(value ?? "Personagem").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Personagem";
  }

  function safeJson(value) {
    return JSON.stringify(value, null, 2).replaceAll("&", "\\u0026").replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  }

  function saveHtml() {
    try {
      const sheet = readSheetFromForm();
      const nextPayload = { ...(originalPayload && typeof originalPayload === "object" ? originalPayload : {}), format: "agentes-aparicoes-sheet", formatVersion: 2, exportedAt: new Date().toISOString(), exportedFrom: "browser-editor", sheet };
      let html = `<!doctype html>\n${document.documentElement.outerHTML}`;
      const dataTag = /(<script id="aa-sheet-data" type="application\/json">)[\s\S]*?(<\/script>)/i;
      if (!dataTag.test(html)) throw new Error("Não foi possível encontrar os dados internos da ficha HTML.");
      html = html.replace(dataTag, (_match, open, close) => `${open}${safeJson(nextPayload)}${close}`);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `Ficha-${sanitizeFilename(sheet.characterName)}.html`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      originalPayload = nextPayload;
      document.title = `${sheet.characterName} | Ficha A&A`;
      setNotice("Ficha salva em um novo arquivo HTML. Importe esse arquivo no Owlbear para atualizar o personagem.", "success");
    } catch (error) {
      console.error("A&A: erro ao salvar ficha HTML.", error); setNotice(error?.message || "Não foi possível salvar a ficha.", "error");
    }
  }

  document.addEventListener("keydown", (event) => {
    const heading = event.target.closest?.(".collapsible-heading-toggle[data-collapse-target]");
    if (!heading || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); heading.click();
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const save = target.closest("#save-standalone-sheet");
    if (save) { event.preventDefault(); saveHtml(); return; }
    const addEquipmentButton = target.closest("[data-add-equipment]");
    if (addEquipmentButton) { event.preventDefault(); addEquipment(addEquipmentButton.dataset.addEquipment); return; }
    const equipmentAction = target.closest("[data-equipment-action]");
    if (equipmentAction) {
      event.preventDefault();
      const card = equipmentAction.closest("[data-inventory-card]");
      const action = equipmentAction.dataset.equipmentAction;
      if (action === "edit" && card) openEquipmentEditor(card.dataset.inventoryCategory, card._equipmentData);
      else if (action === "attack" && card) attackWeapon(card._equipmentData);
      else if (["toggle-equipped", "reaction", "uses-down", "uses-up"].includes(action) && card) modifyEquipment(card, action);
      return;
    }
    if (target.closest("#defense-active-toggle")) { defenseActiveDraft = !defenseActiveDraft; updateDefenseDisplay(); setNotice(defenseActiveDraft ? "Defesa Ativa aplicada." : "Defesa Ativa encerrada.", "info"); return; }
    if (target.closest("#equipment-dialog-save")) { saveEquipmentEditor(); return; }
    if (target.closest("#equipment-dialog-cancel, #equipment-dialog-close")) { cancelEquipmentEditor(); return; }
    if (target.closest("#weapon-attack-roll")) { runStandaloneAttack(); return; }
    if (target.closest("#weapon-attack-cancel, #weapon-attack-close")) { byId("weapon-attack-dialog").close(); return; }
    if (target.closest("#edit-token-name-appearance")) { event.preventDefault(); openNameAppearanceDialog(); return; }
    if (target.closest("#cancel-name-appearance")) { event.preventDefault(); byId("name-appearance-dialog").close(); return; }
    if (target.closest("#save-name-appearance")) { event.preventDefault(); saveNameAppearance(); return; }
    if (target.closest("#reset-name-appearance")) { event.preventDefault(); resetNameAppearanceToRoom(); return; }
    if (target.closest("[data-open-resource-settings]")) { event.preventDefault(); openResourceSettingsDialog(); return; }
    const resourceStep = target.closest("[data-resource-step]");
    if (resourceStep) { event.preventDefault(); stepResource(resourceStep.dataset.resourceStep, Number.parseInt(resourceStep.dataset.resourceDelta, 10) || 0); return; }
    const chronic = target.closest("[data-config-chronic]");
    if (chronic) {
      event.preventDefault();
      const key = chronic.dataset.configChronic === "wounds" ? "woundsChronic" : "stressChronic";
      resourceSettingsDraft[key] = Math.max(0, Math.min(9999, resourceSettingsDraft[key] + (Number.parseInt(chronic.dataset.resourceDelta, 10) || 0)));
      byId(key === "woundsChronic" ? "config-wounds-chronic-value" : "config-stress-chronic-value").textContent = String(resourceSettingsDraft[key]);
      return;
    }
    if (target.closest("#cancel-resource-settings")) { event.preventDefault(); byId("resource-settings-dialog").close(); return; }
    if (target.closest("#save-resource-settings")) { event.preventDefault(); saveResourceSettings(); return; }
    const tab = target.closest("[data-sheet-tab]");
    if (tab) {
      const id = tab.dataset.sheetTab;
      for (const panel of form.querySelectorAll("[data-sheet-panel]")) panel.hidden = panel.id !== id;
      for (const button of form.querySelectorAll("[data-sheet-tab]")) {
        const active = button === tab; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active));
      }
      return;
    }
    const collapse = target.closest("[data-collapse-target]");
    if (collapse) {
      const panel = byId(collapse.dataset.collapseTarget); if (!panel) return;
      const expanded = collapse.getAttribute("aria-expanded") !== "false";
      panel.hidden = expanded; collapse.setAttribute("aria-expanded", String(!expanded)); collapse.classList.toggle("is-collapsed", expanded); return;
    }
    const preview = target.closest(".formatted-editor[data-replace-mode=" + '"true"' + "] .markdown-preview");
    if (preview) {
      const wrapper = preview.closest(".formatted-editor"); const editor = wrapper?.querySelector("input,textarea");
      if (!editor) return; wrapper.classList.remove("is-preview-mode"); preview.hidden = true; editor.hidden = false; editor.focus();
      try { editor.setSelectionRange(editor.value.length, editor.value.length); } catch { /* some controls do not support selection */ }
      return;
    }
    const addHandlers = {
      "add-inventory-item": ["inventory", { id: createId("item"), name: "", spaces: 1, description: "" }],
      "add-power": ["powers", { id: createId("ability"), name: "", traits: "", description: "" }],
      "add-ritual": ["rituals", { id: createId("ability"), name: "", traits: "", description: "" }],
      "add-parameter": ["parameters", { id: createId("parameter"), name: "", description: "" }],
      "add-trauma": ["traumas", { id: createId("trauma"), name: "", description: "" }],
    };
    for (const [buttonId, [field, entry]] of Object.entries(addHandlers)) {
      if (target.closest(`#${buttonId}`)) {
        const next = readSheetFromForm(); next[field].push(entry); renderEntryLists(next); setNotice("Entrada adicionada. Não esqueça de salvar a ficha.", "info"); return;
      }
    }
    const inventoryRemove = target.closest("[data-remove-inventory]");
    if (inventoryRemove) { const card = inventoryRemove.closest("[data-inventory-card]"); if (card) modifyEquipment(card, "remove"); return; }
    const remove = target.closest("[data-remove-ability], [data-remove-profile-entry]");
    if (remove) {
      remove.closest("[data-ability-card], [data-profile-card]")?.remove(); updateInventorySpaceTotal(); return;
    }
    const editSpaces = target.closest("[data-edit-spaces]");
    if (editSpaces) {
      const card = editSpaces.closest("[data-inventory-card]"); const input = card?.querySelector('[data-inventory-field="spaces"]');
      if (input) { editSpaces.hidden = true; input.hidden = false; input.focus(); input.select(); } return;
    }
    const spacesSummary = target.closest("#inventory-spaces-used");
    if (spacesSummary) { spacesSummary.hidden = true; const editor = byId("inventory-spaces-editor"); editor.value = byId("inventory-spaces").value; editor.hidden = false; editor.focus(); editor.select(); }
  });

  document.addEventListener("focusout", (event) => {
    const editor = event.target instanceof HTMLElement && event.target.matches("input,textarea") ? event.target : null;
    if (!editor) return;
    const wrapper = editor.closest('.formatted-editor[data-replace-mode="true"]');
    if (wrapper) setTimeout(() => { if (wrapper.contains(document.activeElement)) return; updatePreview(editor); }, 0);
    if (editor.matches('[data-inventory-field="spaces"]')) {
      const card = editor.closest("[data-inventory-card]"); const preview = card?.querySelector("[data-edit-spaces]");
      if (preview) { preview.textContent = `${nonNegative(editor.value, 1)} esp.`; editor.hidden = true; preview.hidden = false; }
    }
    if (editor.id === "inventory-spaces-editor") finishInventorySpacesEdit(true);
  });

  function finishInventorySpacesEdit(save) {
    const editor = byId("inventory-spaces-editor"); const summary = byId("inventory-spaces-used"); const limit = byId("inventory-spaces");
    if (save && String(editor.value).trim() !== "") limit.value = String(nonNegative(editor.value, 0));
    editor.hidden = true; summary.hidden = false; updateInventorySpaceTotal();
  }

  document.addEventListener("keydown", (event) => {
    if (event.target?.id === "inventory-spaces-editor" && event.key === "Enter") { event.preventDefault(); finishInventorySpacesEdit(true); }
    if (event.target?.id === "inventory-spaces-editor" && event.key === "Escape") { event.preventDefault(); finishInventorySpacesEdit(false); }
  });

  for (const dialogId of ["name-appearance-dialog", "resource-settings-dialog", "equipment-dialog", "weapon-attack-dialog"]) {
    const dialog = byId(dialogId);
    dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", (event) => {
    const field = event.target;
    if (field?.id === "character-name") { byId("selected-name").textContent = field.value.trim() || "Personagem"; document.title = `${field.value.trim() || "Personagem"} | Ficha A&A`; }
    if (field?.id === "token-name-size") byId("token-name-size-value").textContent = `${field.value}%`;
    if (field?.matches('[data-inventory-field="spaces"]')) updateInventorySpaceTotal();
    if (field?.matches("[data-skill-rank]")) updateDefenseDisplay();
    if (field?.matches("[data-markdown-editor]") && field.dataset.formatReplace !== "true") {
      const preview = field.closest(".formatted-editor")?.querySelector(".markdown-preview");
      if (preview) setTimeout(() => updatePreview(field), 350);
    }
  });

  try {
    originalPayload = JSON.parse(payloadElement.textContent || "{}");
    const initial = normalizeSheet(originalPayload.sheet && typeof originalPayload.sheet === "object" ? originalPayload.sheet : originalPayload);
    renderToForm(initial);
  } catch (error) {
    console.error("A&A: arquivo HTML de ficha inválido.", error); setNotice("Não foi possível ler os dados desta ficha. Exporte novamente pelo Owlbear.", "error");
  }
})();
