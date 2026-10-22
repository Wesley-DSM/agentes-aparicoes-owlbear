import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

 test("appearance layout choices expose selected placement and alignment in compact controls", () => {
  for (const id of ["bar-placement", "name-placement", "name-alignment", "defense-alignment", "bar-alignment"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-label=`));
  }
  assert.match(html, /Status em cima/);
  assert.match(html, /Status em baixo/);
  assert.match(html, /Nome à esquerda/);
  assert.match(html, /Barras à direita/);
  assert.doesNotMatch(html, /<h3>Disposição<\/h3>/);
  assert.doesNotMatch(html, /Alinhamento dos elementos/);
});

test("bar color popup uses split fill and background bars without redundant field labels", () => {
  assert.match(html, /class="appearance-bar-color-row" aria-label="Cores de Ferimentos"/);
  assert.match(html, /class="appearance-bar-color-row" aria-label="Cores de Estresses"/);
  for (const id of ["wounds-color", "wounds-background-color", "stress-color", "stress-background-color"]) {
    assert.match(html, new RegExp(`id="${id}" type="color"`));
  }
  const popup = html.match(/<dialog id="appearance-bars-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
  assert.ok(popup.length > 0, "popup de barras encontrado");
  assert.doesNotMatch(popup, /Cor preenchida|Cor de fundo|Fonte do número/);
});

test("appearance preview and compact popups retain the core controls without explanatory copy", () => {
  assert.match(html, />Nome do Personagem<\/button>/);
  assert.match(html, /id="appearance-bars-dialog"/);
  assert.match(html, /id="appearance-defenses-dialog"/);
  assert.match(html, /id="appearance-names-dialog"/);
  assert.doesNotMatch(html, /A borda arredondada representa a largura do token/);
  assert.doesNotMatch(html, /O tamanho máximo é calculado em relação à largura do token/);
});
