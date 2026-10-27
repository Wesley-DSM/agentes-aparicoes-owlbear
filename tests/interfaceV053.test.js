import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("settings include a visible, accessible inline-format tutorial tab", () => {
  const html = read("../index.html");
  assert.match(html, /data-settings-tab="settings-tutorial-pane"/);
  assert.match(html, /\[Dano 1d6\]/);
  assert.match(html, /\[\[@Percepção\]\]/);
  assert.match(html, /\[\[https:\/\/\.\.\.\/imagem\.gif\]\]/);
});

test("damage breakdown dialog is connected to a clickable roll-history damage tile", () => {
  const html = read("../index.html");
  const main = read("../src/main.js");
  assert.match(html, /id="weapon-damage-dialog"/);
  assert.match(html, /id="weapon-damage-calculation"/);
  assert.match(main, /getDamageCalculationParts/);
  assert.match(main, /data-weapon-damage/);
  assert.match(main, /openWeaponDamageCalculation/);
});

test("equipment cards reuse the shared trait class for weapon and armor values", () => {
  const sheet = read("../src/sheet.js");
  assert.match(sheet, /className = "ability-trait"/);
  assert.match(sheet, /Evasão \$\{item\.evasionBase\} \+ Agilidade/);
  assert.match(sheet, /Defesa ativa: EVA/);
  const styles = read("../src/style.css");
  assert.match(styles, /border-radius: var\(--aa-equipment-damage-radius,\s*25%\)/);
  assert.doesNotMatch(styles, /equipment-card-traits \.ability-trait \{ margin: 0; padding:/);
});

test("standalone equipment treats Sem Armadura like an ordinary armor item", () => {
  const runtime = read("../src/standalone-runtime.js");
  assert.doesNotMatch(runtime, /defaultEquipmentKey === "no-armor"\) \{ const badge/);
  assert.doesNotMatch(runtime, /if \(item\.defaultEquipmentKey === "no-armor"\) return/);
  assert.match(runtime, /Evasão \$\{item\.evasionBase\} \+ Agilidade/);
});


test("Defletir and Aparar have separate reaction controls and affect only their mapped defenses", () => {
  const html = read("../sheet.html");
  const sheet = read("../src/sheet.js");
  const equipment = read("../src/equipment.js");
  assert.match(html, /id="defletir-toggle"[^>]*>Defletir<\/button>/);
  assert.match(html, /id="aparar-toggle"[^>]*>Aparar<\/button>/);
  assert.match(html, /class="reaction-defense-buttons"/);
  assert.match(sheet, /toggleReactionDefense\("defletir"\)/);
  assert.match(sheet, /toggleReactionDefense\("aparar"\)/);
  assert.match(equipment, /evasion.*defletirBonus/s);
  assert.match(equipment, /protection.*apararBonus/s);
  assert.match(equipment, /const conviction = getSkillRank\(skills, "vontade"\)/);
});

test("sheet startup includes a loading watchdog and a visible failure state", () => {
  const html = read("../sheet.html");
  const sheet = read("../src/sheet.js");
  assert.match(html, /failIfStuck/);
  assert.match(html, /classList\.remove\("not-ready"\)/);
  assert.match(sheet, /withTimeout\(OBR\.player\.getRole\(\)/);
  assert.match(sheet, /selectedName\.textContent = "Falha ao carregar"/);
});
