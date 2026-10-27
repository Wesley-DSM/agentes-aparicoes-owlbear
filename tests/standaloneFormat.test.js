import test from "node:test";
import assert from "node:assert/strict";
import { buildStandaloneHtml, extractSheetFromImport, preserveExistingAbilityLists } from "../src/standaloneFormat.js";

const template = `<!doctype html><html><head><title>Ficha A&A</title></head><body><main id="app" class="sheet-page not-ready"><header><button id="reset-sheet">Opções</button></header><div class="sheet-actions"><button>Initiative</button></div><button id="toggle-token-name">Ocultar nome</button><dialog id="sheet-options-dialog"><button>Exportar</button></dialog><dialog id="reset-sheet-dialog">Reset</dialog><dialog id="delete-token-dialog">Delete</dialog><input id="import-sheet-file" type="file"><form id="sheet-form"></form><section class="notice" id="notice">Conectando…</section></main><script type="module" src="./src/sheet.js"></script></body></html>`;

test("standalone HTML inlines the styles, editor and sheet data without Owlbear-only actions", () => {
  const payload = { format: "agentes-aparicoes-sheet", formatVersion: 2, sheet: { characterName: "Ana", history: "História" } };
  const html = buildStandaloneHtml({ template, styles: "body { color: white; }", runtime: "console.log('standalone');", payload });
  assert.match(html, /id="save-standalone-sheet"/);
  assert.match(html, /<style>[\s\S]*body \{ color: white; \}/);
  assert.match(html, /id="aa-sheet-data" type="application\/json"/);
  assert.match(html, /console\.log\('standalone'\)/);
  assert.doesNotMatch(html, /src="\.\/src\/sheet\.js"/);
  assert.doesNotMatch(html, /id="sheet-options-dialog"/);
  assert.doesNotMatch(html, /id="add-to-initiative"/);
  assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1);
});

test("standalone HTML escapes script-sensitive character content and can be imported without executing it", () => {
  const sheet = { characterName: "Ana", history: "Texto </script><script>alert(1)</script> & fim", skills: [] };
  const payload = { format: "agentes-aparicoes-sheet", formatVersion: 2, sheet };
  const html = buildStandaloneHtml({ template, styles: "", runtime: "void 0;", payload });
  assert.doesNotMatch(html, /Texto <\/script><script>alert/);
  const imported = extractSheetFromImport(html, "Ficha-Ana.html");
  assert.equal(imported.history, sheet.history);
  assert.equal(imported.characterName, "Ana");
});

test("legacy JSON exports are still accepted", () => {
  const legacy = JSON.stringify({ format: "agentes-aparicoes-sheet", formatVersion: 1, sheet: { characterName: "Bia", powers: [] } });
  assert.equal(extractSheetFromImport(legacy, "Ficha-Bia.json").characterName, "Bia");
});

test("unrecognized HTML does not import as a character sheet", () => {
  assert.throws(() => extractSheetFromImport("<!doctype html><html><body>Not a sheet</body></html>", "bad.html"), /não contém dados/i);
});


test("standalone exports retain powers and rituals in the embedded payload", () => {
  const abilities = {
    powers: [{ id: "p1", name: "Força Sobrenatural", traits: "Passivo", description: "Texto do poder" }],
    rituals: [{ id: "r1", name: "Selo", traits: "Ação", description: "Texto do ritual" }],
  };
  const html = buildStandaloneHtml({
    template,
    styles: "",
    runtime: "void 0;",
    payload: { format: "agentes-aparicoes-sheet", formatVersion: 2, sheet: { characterName: "Ana", ...abilities } },
  });
  const imported = extractSheetFromImport(html, "Ficha-Ana.html");
  assert.deepEqual(imported.powers, abilities.powers);
  assert.deepEqual(imported.rituals, abilities.rituals);
});

test("import protects existing powers and rituals when the exported arrays are missing or accidentally empty", () => {
  const existing = {
    powers: [{ id: "p1", name: "Poder" }],
    rituals: [{ id: "r1", name: "Ritual" }],
  };
  const result = preserveExistingAbilityLists({ characterName: "Ana", powers: [], rituals: null }, existing);
  assert.deepEqual(result.sheet.powers, existing.powers);
  assert.deepEqual(result.sheet.rituals, existing.rituals);
  assert.deepEqual(result.preserved, ["powers", "rituals"]);
});

test("explicit list edits allow intentionally clearing powers or rituals", () => {
  const existing = { powers: [{ id: "p1", name: "Poder" }], rituals: [{ id: "r1", name: "Ritual" }] };
  const result = preserveExistingAbilityLists({ powers: [], rituals: [], __abilityListsEdited: ["powers"] }, existing);
  assert.deepEqual(result.sheet.powers, []);
  assert.deepEqual(result.sheet.rituals, existing.rituals);
});


test("import protects powers and rituals when arrays contain only malformed entries", () => {
  const existing = {
    powers: [{ id: "p1", name: "Poder", traits: "Passivo", description: "Mantido" }],
    rituals: [{ id: "r1", name: "Ritual", traits: "Ação", description: "Mantido" }],
  };
  const result = preserveExistingAbilityLists({ powers: [null, "inválido"], rituals: [null] }, existing);
  assert.deepEqual(result.sheet.powers, existing.powers);
  assert.deepEqual(result.sheet.rituals, existing.rituals);
  assert.deepEqual(result.preserved, ["powers", "rituals"]);
});


test("import recovers legacy power and ritual arrays stored outside a nested sheet object", () => {
  const legacyWrapped = JSON.stringify({
    format: "agentes-aparicoes-sheet",
    sheet: { characterName: "Ana" },
    powers: [{ id: "p1", name: "Poder", traits: "Passivo", description: "Dados legados" }],
    rituals: [{ id: "r1", name: "Ritual", traits: "Ação", description: "Dados legados" }],
  });
  const imported = extractSheetFromImport(legacyWrapped, "Ficha-Ana.json");
  assert.equal(imported.powers[0].name, "Poder");
  assert.equal(imported.rituals[0].name, "Ritual");
});
