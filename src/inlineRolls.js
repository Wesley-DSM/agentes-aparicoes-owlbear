import { calculateTestResult } from "./diceRules.js";

const INLINE_ROLL_PATTERN = /\[\[\s*(?:(\d{1,2})\s*d\s*10|([^\]]+?))\s*\]\]/gi;

function rollD10() {
  if (!globalThis.crypto?.getRandomValues) return Math.floor(Math.random() * 10) + 1;
  const limit = Math.floor(0x100000000 / 10) * 10;
  const sample = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return (sample[0] % 10) + 1;
}

function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(left, right) {
  const a = String(left);
  const b = String(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return previous[b.length];
}

function normalizeSkills(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    id: String(skill?.id ?? ""),
    name: String(skill?.name ?? skill?.label ?? ""),
    rank: Math.max(1, Math.min(5, Number.parseInt(skill?.rank, 10) || 1)),
  })).filter((skill) => skill.name);
}

function findSkill(query, knownSkills) {
  const normalizedQuery = normalizedName(String(query ?? "").replace(/^@/, "").trim());
  if (!normalizedQuery) return null;

  const exact = knownSkills.filter((item) => normalizedName(item.id) === normalizedQuery || normalizedName(item.name) === normalizedQuery);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Permit a small typo without accidentally choosing a substantially different skill.
  const maxDistance = normalizedQuery.length >= 9 ? 2 : normalizedQuery.length >= 4 ? 1 : 0;
  if (!maxDistance) return null;
  const candidates = knownSkills.map((skill) => ({
    skill,
    distance: Math.min(editDistance(normalizedQuery, normalizedName(skill.name)), editDistance(normalizedQuery, normalizedName(skill.id))),
  })).filter((candidate) => candidate.distance <= maxDistance).sort((a, b) => a.distance - b.distance);
  if (!candidates.length || (candidates[1] && candidates[1].distance === candidates[0].distance)) return null;
  return candidates[0].skill;
}

export function isInlineRollSyntax(value) {
  const source = String(value ?? "").trim();
  return /^\[\[\s*(?:\d{1,2}\s*d\s*10|[^\]]+?)\s*\]\]$/i.test(source) && !/^\[\[\s*https?:\/\//i.test(source);
}

export function inlineRollLabel(value) {
  const source = String(value ?? "").trim().replace(/^\[\[\s*/, "").replace(/\s*\]\]$/, "").trim();
  const dice = source.match(/^(\d{1,2})\s*d\s*10$/i);
  if (dice) return `${Number(dice[1])}d10`;
  return source.replace(/^@/, "").trim();
}

/** Resolve a skill reference used to display its value in a sheet description. */
export function resolveSkillReference(value, skills = []) {
  let query = String(value ?? "").trim();
  const passive = /\s+passiva\s*$/i.test(query);
  if (passive) query = query.replace(/\s+passiva\s*$/i, "").trim();
  const skill = findSkill(query, normalizeSkills(skills));
  if (!skill) return null;
  return {
    ...skill,
    passive,
    value: passive ? 4 + skill.rank : skill.rank,
  };
}

/** Resolve inline roll syntax in a chat message or ability description. */
export function resolveInlineRolls(source, skills = [], maxRolls = 10) {
  const text = String(source ?? "");
  const knownSkills = normalizeSkills(skills);
  const rolls = [];
  const errors = [];
  let limited = false;
  INLINE_ROLL_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(INLINE_ROLL_PATTERN)) {
    const syntax = match[0];
    // Double-bracket image references use the same delimiters and are not rolls.
    if (!match[1] && /^https?:\/\//i.test(String(match[2] ?? "").trim())) continue;
    // Plain references show a value/label and do not consume the inline-roll limit.
    if (!match[1] && !String(match[2] ?? "").trim().startsWith("@")) continue;
    if (rolls.length >= maxRolls) {
      limited = true;
      break;
    }

    if (match[1]) {
      const count = Number(match[1]);
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        errors.push(`A rolagem inline deve usar de 1d10 a 5d10: ${syntax}`);
        continue;
      }
      const dice = Array.from({ length: count }, rollD10).sort((a, b) => b - a);
      rolls.push({ type: "dice-roll", syntax, label: `${count}d10`, dice, dt: null });
      continue;
    }

    const reference = String(match[2] ?? "").trim();
    // Unprefixed skill references display their current value in a sheet description.
    // Only an explicit @ asks the parser to roll that skill.
    if (!reference.startsWith("@")) continue;
    const query = reference.slice(1).trim();
    const skill = findSkill(query, knownSkills);
    if (!skill) {
      errors.push(`A perícia “${query}” não foi encontrada. Confira o nome e selecione um token com essa perícia.`);
      continue;
    }
    const dice = Array.from({ length: skill.rank }, rollD10).sort((a, b) => b - a);
    rolls.push({
      type: "skill-roll",
      syntax,
      label: skill.name,
      skillId: skill.id,
      skillName: skill.name,
      rank: skill.rank,
      dice,
      dt: null,
    });
  }

  if (limited) errors.push(`Cada mensagem pode conter no máximo ${maxRolls} rolagens inline.`);
  return { rolls, errors };
}

function getDieHistory(die) {
  if (Number.isInteger(die) && die >= 1 && die <= 10) return [die];
  if (Array.isArray(die) && die.length && die.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) return die;
  if (Array.isArray(die?.rolls) && die.rolls.length && die.rolls.every((value) => Number.isInteger(value) && value >= 1 && value <= 10)) return die.rolls;
  return [];
}

export function getInlineDieHistories(roll) {
  return (Array.isArray(roll?.dice) ? roll.dice : []).map(getDieHistory).filter((history) => history.length);
}

function setDatasetIfPresent(element, name, value) {
  if (value !== undefined && value !== null && value !== "") element.dataset[name] = String(value);
}

/** Draw inline rolls above the description, with the same DT and reroll controls as normal rolls. */
export function renderInlineRolls(container, rolls = [], options = {}) {
  container.replaceChildren();
  const validRolls = Array.isArray(rolls) ? rolls : [];
  if (!validRolls.length) {
    container.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  validRolls.forEach((roll, rollIndex) => {
    const histories = getInlineDieHistories(roll);
    if (!histories.length) return;
    const row = document.createElement("div");
    row.className = "inline-roll-entry";
    row.dataset.inlineRollType = roll.type === "skill-roll" ? "skill-roll" : "dice-roll";
    row.dataset.inlineRollIndex = String(rollIndex);
    setDatasetIfPresent(row, "inlineRollEntry", options.entryId);

    const heading = document.createElement("div");
    heading.className = "inline-roll-heading";
    const title = document.createElement("strong");
    title.className = "inline-roll-title";
    title.textContent = roll.type === "skill-roll"
      ? String(roll.skillName || roll.label || "Perícia")
      : String(roll.label || `${histories.length}d10`);
    const result = document.createElement("strong");
    result.className = "roll-history-test-result inline-roll-test-result";
    result.hidden = true;
    const formula = document.createElement("span");
    formula.className = "inline-roll-formula";
    formula.textContent = `${histories.length}d10`;
    heading.append(title, result, formula);

    const diceRow = document.createElement("div");
    diceRow.className = "roll-history-dice-row inline-roll-dice-row";
    const values = document.createElement("div");
    values.className = "roll-history-dice inline-roll-dice";
    values.setAttribute("aria-label", `${histories.length} dados d10: ${histories.map((history) => history[history.length - 1]).join(", ")}`);
    histories.forEach((history, dieIndex) => {
      const group = document.createElement("span");
      group.className = "roll-history-die-group";
      history.slice(0, -1).forEach((oldValue) => {
        const discarded = document.createElement("span");
        discarded.className = oldValue === 10
          ? "roll-history-die roll-history-die-ten roll-history-die-discarded"
          : "roll-history-die roll-history-die-discarded";
        discarded.textContent = String(oldValue);
        discarded.title = `Resultado anterior descartado: ${oldValue}`;
        group.append(discarded);
      });
      const value = history[history.length - 1];
      const die = document.createElement("button");
      die.type = "button";
      die.className = value === 10 ? "roll-history-die roll-history-die-ten roll-history-die-current inline-roll-current-die" : "roll-history-die roll-history-die-current inline-roll-current-die";
      die.textContent = String(value);
      die.title = `Clique para rerrolar o d10 ${dieIndex + 1}: ${value}`;
      die.setAttribute("aria-label", `Rerrolar o dado ${dieIndex + 1}, resultado atual ${value}`);
      setDatasetIfPresent(die, "inlineRollEntry", options.entryId);
      die.dataset.inlineRollIndex = String(rollIndex);
      die.dataset.inlineDieIndex = String(dieIndex);
      if (!options.entryId || history.length >= 6) {
        die.disabled = !options.entryId || history.length >= 6;
        if (history.length >= 6) die.title = `Limite de rerrolagens atingido para o dado ${dieIndex + 1}`;
      }
      group.append(die);
      values.append(group);
    });
    diceRow.append(values);

    const testRow = document.createElement("div");
    testRow.className = "roll-history-test-row inline-roll-test-row";
    const dtLabel = document.createElement("label");
    dtLabel.className = "roll-history-dt-label";
    dtLabel.textContent = "DT";
    const dtInput = document.createElement("input");
    dtInput.type = "number";
    dtInput.min = "0";
    dtInput.max = "9999";
    dtInput.step = "1";
    dtInput.inputMode = "numeric";
    dtInput.className = "roll-history-dt-input inline-roll-dt-input";
    dtInput.value = roll.dt === null || roll.dt === undefined ? "" : String(roll.dt);
    dtInput.placeholder = "DT";
    dtInput.setAttribute("aria-label", `Dificuldade do teste de ${roll.type === "skill-roll" ? roll.skillName : roll.label || "rolagem inline"}`);
    setDatasetIfPresent(dtInput, "inlineRollDtEntry", options.entryId);
    dtInput.dataset.inlineRollIndex = String(rollIndex);
    dtLabel.append(dtInput);
    testRow.append(dtLabel);
    diceRow.append(testRow);
    row.append(heading, diceRow);
    updateInlineRollTestResult(row, roll, dtInput.value);
    fragment.append(row);
  });

  container.append(fragment);
  container.hidden = !container.childElementCount;
}

export function updateInlineRollTestResult(row, roll, rawDt = null) {
  const output = row?.querySelector(".inline-roll-test-result");
  const input = row?.querySelector(".inline-roll-dt-input");
  if (!output || !input) return;
  const result = calculateTestResult({ dice: getInlineDieHistories(roll).map((rolls) => ({ rolls })) }, rawDt === null ? input.value : rawDt);
  if (rawDt === "" || rawDt === null || rawDt === undefined || !result) {
    output.textContent = "";
    output.hidden = true;
    output.dataset.result = "";
    return;
  }
  output.hidden = false;
  output.dataset.result = result.success ? "success" : "failure";
  output.textContent = `${result.success ? "Sucesso" : "Falha"}. Total ${result.total}, ${result.criticals} ${result.criticals === 1 ? "crítico" : "críticos"}.`;
}
