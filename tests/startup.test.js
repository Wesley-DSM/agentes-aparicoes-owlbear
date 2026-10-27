import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheetSource = await readFile(new URL("../src/sheet.js", import.meta.url), "utf8");

test("ability-list edit tracker is initialized before the first sheet render", () => {
  const declarationIndex = sheetSource.indexOf("const dirtyAbilityLists = new Set();");
  const renderIndex = sheetSource.indexOf("function writeSheetToForm(sheet)");
  assert.notEqual(declarationIndex, -1, "dirtyAbilityLists must be declared");
  assert.ok(renderIndex > declarationIndex, "the tracker must exist before writeSheetToForm can clear it");
  assert.match(sheetSource.slice(renderIndex, renderIndex + 300), /dirtyAbilityLists\.clear\(\)/);
});
