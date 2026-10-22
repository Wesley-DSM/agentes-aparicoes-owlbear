export const EQUIPMENT_CATEGORIES = Object.freeze(["weapon", "armor", "supply"]);

export function createDefaultEquipment() {
  return [
    {
      id: "default-punch", defaultEquipmentKey: "punch", category: "weapon", name: "Punho", spaces: 0,
      description: "Multiataque, Marcial - Empunhadura: 1 Espaços: 0 Engates: 0 Discreta - Corporal: 1m - Aparar, Defletir.",
      weaponClass: "Marcial", skill: "armas-simples", damage: "Força", critical: "1",
      reactionEvasion: 0, reactionProtection: 0, reactionActive: false,
    },
    {
      id: "default-no-armor", defaultEquipmentKey: "no-armor", category: "armor", armorKind: "armadura", name: "Sem Armadura", spaces: 0,
      description: "Evasão 4 + Agilidade. Proteção = Fortitude. Espaços: 0, Engates: 0.",
      evasionBonus: 0, protectionBonus: 0, activeEvasion: 1, activeProtection: 0, equipped: true,
    },
  ];
}

export function normalizeEquipment(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === "object").map((item) => {
    const category = EQUIPMENT_CATEGORIES.includes(item.category) ? item.category : "supply";
    const defaultSpaces = category === "supply" ? 1 : 0;
    const normalized = {
      id: typeof item.id === "string" && item.id ? item.id : `item-${Math.random().toString(36).slice(2, 10)}`,
      defaultEquipmentKey: ["punch", "no-armor"].includes(item.defaultEquipmentKey) ? item.defaultEquipmentKey : "",
      category,
      name: String(item.name ?? "").slice(0, 140),
      spaces: Math.max(0, Math.min(9999, Number.parseInt(item.spaces, 10) || (item.spaces === 0 || item.spaces === "0" ? 0 : defaultSpaces))),
      description: String(item.description ?? "").slice(0, 4000),
      uses: item.uses === "" || item.uses === null || item.uses === undefined ? "" : String(Math.max(0, Math.min(9999, Number.parseInt(item.uses, 10) || 0))),
      equipped: Boolean(item.equipped),
      weaponClass: item.weaponClass === "Marcial" ? "Marcial" : "Simples",
      skill: item.skill === "armas-de-fogo" ? "armas-de-fogo" : "armas-simples",
      damage: String(item.damage ?? "").slice(0, 100),
      critical: String(item.critical ?? "").slice(0, 30),
      armorKind: item.armorKind === "escudo" ? "escudo" : "armadura",
      evasionBonus: signedInteger(item.evasionBonus),
      protectionBonus: signedInteger(item.protectionBonus),
      activeEvasion: signedInteger(item.activeEvasion),
      activeProtection: signedInteger(item.activeProtection),
      reactionEvasion: signedInteger(item.reactionEvasion),
      reactionProtection: signedInteger(item.reactionProtection),
      reactionActive: Boolean(item.reactionActive),
    };
    if (category !== "armor") normalized.equipped = true;
    if (category !== "weapon") normalized.reactionActive = false;
    if (category !== "supply") normalized.uses = "";
    if (!normalized.defaultEquipmentKey && normalized.name.trim().toLowerCase() === "punho" && category === "weapon") normalized.defaultEquipmentKey = "punch";
    if (!normalized.defaultEquipmentKey && normalized.name.trim().toLowerCase() === "sem armadura" && category === "armor") normalized.defaultEquipmentKey = "no-armor";
    return normalized;
  });
}

function signedInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(-999, Math.min(999, number)) : 0;
}

export function initializeEquipment(items, initialized = false) {
  const normalized = normalizeEquipment(items);
  if (initialized) return { inventory: normalized, initialized: true };
  const defaults = createDefaultEquipment();
  for (const item of defaults) {
    if (!normalized.some((existing) => existing.defaultEquipmentKey === item.defaultEquipmentKey)) normalized.unshift(item);
  }
  return { inventory: normalized, initialized: true };
}

export function getSkillRank(skills, id) {
  const skill = Array.isArray(skills) ? skills.find((entry) => entry?.id === id) : null;
  const value = Number.parseInt(skill?.rank, 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(5, value)) : 1;
}

export function calculateDefenses({ skills = [], inventory = [], defenseActive = false } = {}) {
  const equippedArmor = (Array.isArray(inventory) ? inventory : []).filter((item) => item?.category === "armor" && item.equipped);
  const activeWeapons = (Array.isArray(inventory) ? inventory : []).filter((item) => item?.category === "weapon" && item.reactionActive);
  const evasion = 4 + getSkillRank(skills, "agilidade")
    + equippedArmor.reduce((sum, item) => sum + signedInteger(item.evasionBonus), 0)
    + (defenseActive ? equippedArmor.reduce((sum, item) => sum + signedInteger(item.activeEvasion), 0) : 0)
    + activeWeapons.reduce((sum, item) => sum + signedInteger(item.reactionEvasion), 0);
  const protection = getSkillRank(skills, "fortitude")
    + equippedArmor.reduce((sum, item) => sum + signedInteger(item.protectionBonus), 0)
    + (defenseActive ? equippedArmor.reduce((sum, item) => sum + signedInteger(item.activeProtection), 0) : 0)
    + activeWeapons.reduce((sum, item) => sum + signedInteger(item.reactionProtection), 0);
  const conviction = getSkillRank(skills, "vontade");
  return { evasion, protection, conviction };
}

export function evaluateSkillTest(dice, dt) {
  const values = (Array.isArray(dice) ? dice : []).map((die) => Number(die)).filter((die) => Number.isInteger(die) && die >= 1 && die <= 10);
  if (!values.length) throw new Error("A rolagem precisa ter ao menos um dado válido.");
  const target = Number(dt);
  if (!Number.isInteger(target) || target < 0 || target > 9999) throw new Error("Informe uma DT válida.");
  const sorted = [...values].sort((a, b) => b - a);
  const highest = sorted[0];
  const criticals = sorted.filter((die, index) => die === 10 || (index > 0 && die >= target)).length;
  const result = highest + criticals;
  return { dice: sorted, highest, criticals, result, success: result >= target, dt: target };
}

export function rollDamageExpression(expression, strength, criticals, criticalBonus, randomDie = (sides) => Math.floor(Math.random() * sides) + 1) {
  const source = String(expression ?? "").trim();
  if (!source) throw new Error("Preencha o dano da arma.");
  const expanded = source.replace(/força/gi, String(Math.max(1, Number.parseInt(strength, 10) || 1)));
  const terms = expanded.match(/[+-]?\s*(?:\d*d\d+|\d+)/gi);
  if (!terms || terms.join("").replace(/\s/g, "").length !== expanded.replace(/\s/g, "").length) {
    const numeric = Number(expanded);
    if (Number.isFinite(numeric)) return { base: numeric, criticalBonus: Number(criticalBonus) || 0, criticals, total: numeric + (Number(criticalBonus) || 0) * criticals, rolls: [] };
    throw new Error("Use um dano numérico, Força ou uma expressão como 1d6+2.");
  }
  let base = 0;
  const rolls = [];
  for (const term of terms) {
    const sign = term.trim().startsWith("-") ? -1 : 1;
    const atom = term.replace(/[+-]/g, "").trim();
    const dice = atom.match(/^(\d*)d(\d+)$/i);
    if (dice) {
      const count = Number.parseInt(dice[1] || "1", 10);
      const sides = Number.parseInt(dice[2], 10);
      if (count < 1 || count > 20 || sides < 2 || sides > 1000) throw new Error("Expressão de dano fora do limite permitido.");
      for (let index = 0; index < count; index += 1) {
        const value = randomDie(sides);
        rolls.push(value);
        base += sign * value;
      }
    } else {
      base += sign * Number.parseInt(atom, 10);
    }
  }
  const bonus = (Number.parseInt(criticalBonus, 10) || 0) * criticals;
  return { base, criticalBonus: Number.parseInt(criticalBonus, 10) || 0, criticals, total: Math.max(0, base + bonus), rolls };
}
