import OBR from "@owlbear-rodeo/sdk";
import "./style.css";
import { ROLL_POPOVER_ID } from "./rollWindow.js";
import { renderFormattedMarkdown, renderInlineMarkdown } from "./markdown.js";
import { createThemeController } from "./theme.js";
import { renderInlineRolls, updateInlineRollTestResult } from "./inlineRolls.js";
import { MAX_DIE_RESULTS, normalizeRollHistory, readRollHistory, rerollLogDie, ROLL_HISTORY_KEY, updateRollHistoryEntry } from "./rollHistory.js";

const byId = (id) => document.getElementById(id);
const themeController = createThemeController();
OBR.onReady(() => themeController.connect(OBR));

function readPayload() {
  try {
    const raw = new URLSearchParams(window.location.search).get("data");
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.type === "skill-roll") {
      if (
        typeof value.skillName !== "string" ||
        typeof value.characterName !== "string" ||
        typeof value.playerName !== "string" ||
        !Array.isArray(value.dice) ||
        value.dice.length < 1 ||
        value.dice.length > 5 ||
        !value.dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 10)
      ) return null;
      return { ...value, dice: [...value.dice].sort((a, b) => b - a) };
    }
    if (value?.type === "ability-use") {
      if (
        typeof value.abilityName !== "string" ||
        !value.abilityName ||
        value.abilityName.length > 140 ||
        typeof value.characterName !== "string" ||
        typeof value.playerName !== "string" ||
        !["power", "ritual"].includes(value.kind) ||
        typeof value.description !== "string" ||
        value.description.length > 6000 ||
        !Array.isArray(value.traits) ||
        value.traits.length > 20 ||
        !value.traits.every((trait) => typeof trait === "string" && trait.length <= 80)
      ) return null;
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

function renderSkillRoll(roll) {
  byId("roll-player").textContent = `${roll.playerName} rolou`;
  renderInlineMarkdown(byId("roll-skill"), roll.skillName);
  renderInlineMarkdown(byId("roll-character"), roll.characterName);
  byId("roll-count").textContent = `${roll.dice.length}d10`;

  const diceBox = byId("roll-popup-dice");
  const fragment = document.createDocumentFragment();
  for (const [index, value] of roll.dice.entries()) {
    const die = document.createElement("span");
    die.className = value === 10 ? "die die-ten" : "die";
    die.textContent = String(value);
    die.title = value === 10 ? "10!" : String(value);
    die.setAttribute("aria-label", `Dado ${index + 1}: ${value}${value === 10 ? ", resultado 10" : ""}`);
    fragment.append(die);
  }
  diceBox.replaceChildren(fragment);

  const tens = roll.dice.filter((die) => die === 10).length;
  byId("roll-summary").textContent = tens
    ? `Ordem decrescente · ${tens} ${tens === 1 ? "resultado 10" : "resultados 10"}`
    : "Resultados em ordem decrescente";
}

function renderAbilityUse(ability) {
  byId("roll-player").textContent = `${ability.kind === "ritual" ? "Ritual" : "Poder"} · ${ability.playerName}`;
  renderInlineMarkdown(byId("roll-skill"), ability.abilityName);
  renderInlineMarkdown(byId("roll-character"), ability.characterName);
  byId("roll-count").hidden = true;
  byId("roll-popup-dice").hidden = true;
  byId("roll-summary").hidden = true;

  const traits = byId("ability-traits");
  const traitFragment = document.createDocumentFragment();
  for (const traitText of ability.traits) {
    const trait = document.createElement("span");
    trait.className = "ability-trait";
    renderInlineMarkdown(trait, traitText);
    traitFragment.append(trait);
  }
  traits.replaceChildren(traitFragment);
  traits.hidden = ability.traits.length === 0;
  renderInlineRolls(byId("inline-rolls"), ability.inlineRolls ?? [], { entryId: ability.id });
  renderAbilityDescription(ability.description, ability.inlineRolls ?? [], ability.id);
  byId("roll-popup").classList.add("ability-popup");
}

function renderAbilityDescription(description, inlineRolls = [], entryId = "") {
  const container = byId("ability-description");
  const source = String(description ?? "");
  renderFormattedMarkdown(container, source, { inlineRolls, entryId, showInlineResults: true });
  container.hidden = source.length === 0;
}

const payload = readPayload();
if (payload?.type === "skill-roll") {
  renderSkillRoll(payload);
} else if (payload?.type === "ability-use") {
  renderAbilityUse(payload);
} else {
  byId("roll-player").textContent = "Resultado indisponível";
  byId("roll-skill").textContent = "Não foi possível carregar os dados";
  byId("roll-character").textContent = "";
  byId("roll-count").textContent = "";
  byId("roll-popup-dice").replaceChildren();
  byId("roll-summary").textContent = "Feche esta janela e tente novamente.";
}

byId("roll-close").addEventListener("click", () => {
  void OBR.popover.close(ROLL_POPOVER_ID).catch((error) => console.error(error));
});

const inlineRollContainer = byId("inline-rolls");
const inlineRerollDialog = byId("inline-reroll-dialog");
const inlineRerollDescription = byId("inline-reroll-description");
const confirmInlineRerollButton = byId("confirm-inline-reroll");
let pendingInlineReroll = null;

function redrawAbilityInlineRolls(rolls) {
  if (!payload || payload.type !== "ability-use") return;
  payload.inlineRolls = rolls;
  renderInlineRolls(inlineRollContainer, rolls, { entryId: payload.id });
  renderAbilityDescription(payload.description, rolls, payload.id);
}

byId("roll-popup")?.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-inline-roll-entry][data-inline-roll-index][data-inline-die-index]")
    : null;
  if (!button || !payload || payload.type !== "ability-use") return;
  const entryId = button.dataset.inlineRollEntry;
  const inlineRollIndex = Number(button.dataset.inlineRollIndex);
  const dieIndex = Number(button.dataset.inlineDieIndex);
  const roll = payload.inlineRolls?.[inlineRollIndex];
  const die = roll?.dice?.[dieIndex];
  const values = Array.isArray(die?.rolls) ? die.rolls : (Number.isInteger(die) ? [die] : []);
  if (!values.length) return;
  if (values.length >= MAX_DIE_RESULTS) {
    OBR.notification.show("Este dado já atingiu o limite de rerrolagens.");
    return;
  }
  pendingInlineReroll = { entryId, inlineRollIndex, dieIndex, currentValue: values[values.length - 1] };
  inlineRerollDescription.textContent = `O dado atualmente mostra ${pendingInlineReroll.currentValue}. O valor anterior ficará tachado e todos na sala verão a alteração.`;
  if (typeof inlineRerollDialog.showModal === "function") inlineRerollDialog.showModal();
});

byId("cancel-inline-reroll")?.addEventListener("click", () => {
  pendingInlineReroll = null;
  inlineRerollDialog.close();
});
inlineRerollDialog?.addEventListener("click", (event) => {
  if (event.target === inlineRerollDialog) inlineRerollDialog.close();
});
inlineRerollDialog?.addEventListener("close", () => { pendingInlineReroll = null; });
confirmInlineRerollButton?.addEventListener("click", async () => {
  if (!pendingInlineReroll) return;
  const pending = pendingInlineReroll;
  confirmInlineRerollButton.disabled = true;
  try {
    const result = await rerollLogDie(pending.entryId, pending.dieIndex, secureRandomD10(), pending.inlineRollIndex);
    if (!result.ok) {
      OBR.notification.show("Não foi possível rerrolar esta rolagem. Confira se ela já foi registrada no CHAT.");
      return;
    }
    const currentEntry = result.history.find((item) => item.id === pending.entryId);
    if (currentEntry?.inlineRolls) redrawAbilityInlineRolls(currentEntry.inlineRolls);
  } catch (error) {
    console.error("A&A: não foi possível rerrolar a rolagem inline.", error);
    OBR.notification.show("Não foi possível rerrolar o dado. Confira a conexão da sala.");
  } finally {
    pendingInlineReroll = null;
    inlineRerollDialog.close();
    confirmInlineRerollButton.disabled = false;
  }
});

inlineRollContainer?.addEventListener("input", (event) => {
  const input = event.target instanceof Element
    ? event.target.closest("[data-inline-roll-dt-entry][data-inline-roll-index]")
    : null;
  if (!input || !payload || payload.type !== "ability-use") return;
  const roll = payload.inlineRolls?.[Number(input.dataset.inlineRollIndex)];
  if (roll) updateInlineRollTestResult(input.closest(".inline-roll-entry"), roll, input.value);
});

inlineRollContainer?.addEventListener("change", async (event) => {
  const input = event.target instanceof Element
    ? event.target.closest("[data-inline-roll-dt-entry][data-inline-roll-index]")
    : null;
  if (!input || !payload || payload.type !== "ability-use") return;
  try {
    const result = await updateRollHistoryEntry(input.dataset.inlineRollDtEntry, {
      inlineRollIndex: Number(input.dataset.inlineRollIndex),
      inlineDt: input.value === "" ? null : input.value,
    });
    if (!result.ok) {
      OBR.notification.show(result.reason === "invalid-dt"
        ? "A DT deve ser um número inteiro entre 0 e 9999."
        : "Esta rolagem ainda não está registrada no CHAT.");
      return;
    }
    const history = await readRollHistory();
    const currentEntry = normalizeRollHistory(history).find((item) => item.id === input.dataset.inlineRollDtEntry);
    if (currentEntry?.inlineRolls) redrawAbilityInlineRolls(currentEntry.inlineRolls);
  } catch (error) {
    console.error("A&A: não foi possível salvar a DT inline.", error);
    OBR.notification.show("Não foi possível salvar a DT. Confira a conexão da sala.");
  }
});

function secureRandomD10() {
  if (!globalThis.crypto?.getRandomValues) return Math.floor(Math.random() * 10) + 1;
  const limit = Math.floor(0x100000000 / 10) * 10;
  const sample = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return (sample[0] % 10) + 1;
}

OBR.onReady(() => {
  if (!payload || payload.type !== "ability-use") return;
  OBR.room.onMetadataChange((metadata) => {
    const entry = normalizeRollHistory(metadata?.[ROLL_HISTORY_KEY]).find((item) => item.id === payload.id);
    if (!entry?.inlineRolls) return;
    if (JSON.stringify(entry.inlineRolls) !== JSON.stringify(payload.inlineRolls ?? [])) {
      redrawAbilityInlineRolls(entry.inlineRolls);
    }
  });
});
