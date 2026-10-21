import test from "node:test";
import assert from "node:assert/strict";
import { resolveInlineRolls, resolveSkillReference } from "../src/inlineRolls.js";

test("inline dice syntax resolves one through five d10", () => {
  const result = resolveInlineRolls("Teste [[2d10]] e [[1d10]]");
  assert.deepEqual(result.errors, []);
  assert.equal(result.rolls.length, 2);
  assert.equal(result.rolls[0].type, "dice-roll");
  assert.equal(result.rolls[0].dice.length, 2);
  assert.equal(result.rolls[1].dice.length, 1);
  assert.ok(result.rolls.every((roll) => roll.dice.every((value) => value >= 1 && value <= 10)));
});

test("inline skill syntax matches names ignoring accents, spaces and punctuation", () => {
  const result = resolveInlineRolls("[[ @Percepção ]]", [
    { id: "percepcao", name: "Percepção", rank: 3 },
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rolls.length, 1);
  assert.equal(result.rolls[0].type, "skill-roll");
  assert.equal(result.rolls[0].skillId, "percepcao");
  assert.equal(result.rolls[0].dice.length, 3);
});

test("only skill syntax prefixed with @ rolls and a small typo is tolerated", () => {
  const result = resolveInlineRolls("[[Percepao]] e [[@Percepao]]", [
    { id: "percepcao", name: "Percepção", rank: 3 },
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rolls.length, 1);
  assert.equal(result.rolls[0].type, "skill-roll");
  assert.equal(result.rolls[0].skillName, "Percepção");
  assert.equal(result.rolls[0].dice.length, 3);
});

test("skill references resolve current and passive value", () => {
  const skills = [{ id: "percepcao", name: "Percepção", rank: 3 }];
  assert.equal(resolveSkillReference("Percepção", skills).value, 3);
  assert.equal(resolveSkillReference("Percepcao Passiva", skills).value, 7);
  assert.equal(resolveSkillReference("Percepção Passiva", skills).passive, true);
  assert.equal(resolveSkillReference("Desconhecida", skills), null);
});

test("image references inside double brackets are not interpreted as skill rolls", () => {
  const result = resolveInlineRolls("Imagem [[https://example.com/a.png]] e rolagem [[1d10]]", []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rolls.length, 1);
  assert.equal(result.rolls[0].type, "dice-roll");
});

test("unsupported counts and missing skills are reported", () => {
  const result = resolveInlineRolls("[[6d10]] [[ @Desconhecida ]]", []);
  assert.equal(result.rolls.length, 0);
  assert.equal(result.errors.length, 2);
});

test("value references do not create rolls or shift subsequent roll indexes", () => {
  const result = resolveInlineRolls("Resultado [[2d10]] depois [[Percepção]] e [[@Percepção]] fim", [
    { id: "percepcao", name: "Percepção", rank: 2 },
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rolls.length, 2);
  assert.equal(result.rolls[0].type, "dice-roll");
  assert.equal(result.rolls[1].type, "skill-roll");
});
