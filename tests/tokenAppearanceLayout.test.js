import test from "node:test";
import assert from "node:assert/strict";
import { getTokenAppearanceLayout } from "../src/tokenAppearanceLayout.js";

test("status em cima e nome em cima: nome, barras e defesas acima do token", () => {
  assert.deepEqual(getTokenAppearanceLayout("top", "top"), { above: ["name", "bars", "defenses"], below: [] });
});

test("status em cima e nome em baixo: barras e defesas acima; nome abaixo", () => {
  assert.deepEqual(getTokenAppearanceLayout("top", "bottom"), { above: ["bars", "defenses"], below: ["name"] });
});

test("status em baixo e nome em cima: nome acima; defesas e barras abaixo", () => {
  assert.deepEqual(getTokenAppearanceLayout("bottom", "top"), { above: ["name"], below: ["defenses", "bars"] });
});

test("status em baixo e nome em baixo: defesas, barras e nome abaixo do token", () => {
  assert.deepEqual(getTokenAppearanceLayout("bottom", "bottom"), { above: [], below: ["defenses", "bars", "name"] });
});

test("valores inválidos mantêm o padrão seguro de status e nome em baixo", () => {
  assert.deepEqual(getTokenAppearanceLayout("invalid", "invalid"), { above: [], below: ["defenses", "bars", "name"] });
});
