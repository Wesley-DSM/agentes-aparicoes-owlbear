import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDefenses,
  createDefaultEquipment,
  evaluateSkillTest,
  getDamageCalculationParts,
  initializeEquipment,
  normalizeEquipment,
  rollDamageExpression,
} from "../src/equipment.js";

const skills = [
  { id: "agilidade", rank: 3 },
  { id: "fortitude", rank: 2 },
  { id: "vontade", rank: 4 },
  { id: "forca", rank: 3 },
];

test("new sheets include Punho and Sem Armadura with the agreed defaults", () => {
  const state = initializeEquipment(undefined, false);
  const punch = state.inventory.find((item) => item.defaultEquipmentKey === "punch");
  const noArmor = state.inventory.find((item) => item.defaultEquipmentKey === "no-armor");
  assert.equal(state.initialized, true);
  assert.equal(punch.name, "Punho");
  assert.equal(punch.category, "weapon");
  assert.equal(punch.skill, "armas-simples");
  assert.equal(punch.damage, "Força");
  assert.equal(punch.critical, "1");
  assert.match(punch.description, /Multiataque/);
  assert.equal(noArmor.name, "Sem Armadura");
  assert.equal(noArmor.equipped, true);
  assert.equal(noArmor.activeEvasion, 1);
});

test("legacy inventory entries migrate to supplies and receive defaults once", () => {
  const first = initializeEquipment([{ id: "old", name: "Lanterna", spaces: 1, description: "Luz" }], false);
  assert.equal(first.inventory.find((item) => item.id === "old").category, "supply");
  assert.ok(first.inventory.some((item) => item.defaultEquipmentKey === "punch"));
  assert.ok(first.inventory.some((item) => item.defaultEquipmentKey === "no-armor"));
  const afterRemoval = initializeEquipment([{ id: "old", name: "Lanterna", category: "supply" }], true);
  assert.equal(afterRemoval.inventory.length, 1);
});

test("defenses derive from skills and only equipped armor affects defense", () => {
  const inventory = [
    { category: "armor", armorKind: "armadura", equipped: true, evasionBase: 3, protectionBase: 2, activeEvasion: 2, activeProtection: 1 },
    { category: "armor", armorKind: "armadura", equipped: false, evasionBase: 9, protectionBase: 9, activeEvasion: 9, activeProtection: 9 },
  ];
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: false }), { evasion: 6, protection: 4, conviction: 4 });
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: true }), { evasion: 8, protection: 5, conviction: 4 });
});

test("weapon reaction bonuses affect Evasion and Protection, never Conviction", () => {
  const inventory = [{ category: "weapon", reactionActive: true, defletir: 1, aparar: 2 }];
  assert.deepEqual(calculateDefenses({ skills, inventory }), { evasion: 8, protection: 4, conviction: 4 });
});

test("A&A skill tests count tens and qualifying non-highest dice as criticals", () => {
  assert.deepEqual(evaluateSkillTest([10, 8, 6], 7), {
    dice: [10, 8, 6], highest: 10, criticals: 2, result: 12, success: true, dt: 7,
  });
  assert.equal(evaluateSkillTest([7, 4], 8).success, false);
});

test("damage expressions support Força, dice, and per-critical bonuses", () => {
  const fixed = rollDamageExpression("Força", 3, 2, "1", () => 6);
  assert.deepEqual(fixed, { base: 3, criticalBonus: 1, criticals: 2, total: 5, rolls: [] });
  const dice = rollDamageExpression("1d6+2", 3, 1, "2", () => 4);
  assert.deepEqual(dice, { base: 6, criticalBonus: 2, criticals: 1, total: 8, rolls: [4] });
});

test("armors use initial defense values before adding Agility and Fortitude", () => {
  const inventory = [
    { category: "armor", armorKind: "armadura", equipped: true, evasionBase: 1, protectionBase: 3, activeEvasion: 2, activeProtection: 0 },
  ];
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: false }), { evasion: 4, protection: 5, conviction: 4 });
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: true }), { evasion: 6, protection: 5, conviction: 4 });
});

test("shields add bonuses to the equipped armor without changing Conviction", () => {
  const inventory = [
    { category: "armor", armorKind: "armadura", equipped: true, evasionBase: 4, protectionBase: 0 },
    { category: "armor", armorKind: "escudo", equipped: true, evasionBonus: 1, protectionBonus: 2, activeEvasion: 1 },
  ];
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: false }), { evasion: 8, protection: 4, conviction: 4 });
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: true }), { evasion: 9, protection: 4, conviction: 4 });
});

test("new and legacy supply counters normalize to an explicit enabled state", () => {
  const [noCounter, withCounter] = normalizeEquipment([
    { id: "a", category: "supply", name: "Lanterna", uses: "" },
    { id: "b", category: "supply", name: "Kit", uses: "2" },
  ]);
  assert.equal(noCounter.usesEnabled, false);
  assert.equal(noCounter.uses, "");
  assert.equal(withCounter.usesEnabled, true);
  assert.equal(withCounter.uses, "2");
});


test("damage breakdown lists base damage, Strength and one entry for each critical", () => {
  assert.deepEqual(getDamageCalculationParts("2+Força", 3, 2, 2), [
    { label: "Dano Base", value: 2, sign: 1 },
    { label: "Força", value: 3, sign: 1 },
    { label: "Crítico", value: 2, sign: 1 },
    { label: "Crítico", value: 2, sign: 1 },
  ]);
});

test("damage breakdown shows rolled dice individually and retains subtraction signs", () => {
  assert.deepEqual(getDamageCalculationParts("1d6-2+Força", 4, 0, 2, [5]), [
    { label: "Dano Base", value: 5, sign: 1, die: "5/6" },
    { label: "Dano Base", value: 2, sign: -1 },
    { label: "Força", value: 4, sign: 1 },
  ]);
});
