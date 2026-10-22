import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const viteConfig = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");

test("Vite production build includes active HTML entry pages", () => {
  for (const file of ["index.html", "sheet.html", "background.html"]) {
    assert.ok(viteConfig.includes(`"${file}"`), `${file} needs to be a build input`);
  }
});

test("obsolete standalone roll popup code is removed", () => {
  for (const file of ["roll-result.html", "src/roll-result.js", "src/rollWindow.js"]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, `${file} should not remain after roll popup removal`);
  }
  for (const file of ["src/main.js", "src/sheet.js", "src/inlineRolls.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /openRollResultWindow|roll-result\.html/);
  }
});
