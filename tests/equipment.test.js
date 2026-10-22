import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDefenses,
  createDefaultEquipment,
  evaluateSkillTest,
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
    { category: "armor", equipped: true, evasionBonus: -1, protectionBonus: 2, activeEvasion: 2, activeProtection: 1 },
    { category: "armor", equipped: false, evasionBonus: 9, protectionBonus: 9, activeEvasion: 9, activeProtection: 9 },
  ];
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: false }), { evasion: 6, protection: 4, conviction: 4 });
  assert.deepEqual(calculateDefenses({ skills, inventory, defenseActive: true }), { evasion: 8, protection: 5, conviction: 4 });
});

test("weapon reaction bonuses affect Evasion and Protection, never Conviction", () => {
  const inventory = [{ category: "weapon", reactionActive: true, reactionEvasion: 1, reactionProtection: 2 }];
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
