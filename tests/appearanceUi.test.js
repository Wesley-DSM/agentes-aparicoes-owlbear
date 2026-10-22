import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sheetHtml = readFileSync(new URL("../sheet.html", import.meta.url), "utf8");
const barRenderer = readFileSync(new URL("../src/barRenderer.js", import.meta.url), "utf8");

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

test("each preview bar is a single click target and shows only its current value", () => {
  const preview = html.match(/<section id="token-appearance-preview"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(preview.length > 0, "prévia encontrada");
  const bars = [...preview.matchAll(/<button[^>]*class="appearance-preview-bar appearance-preview-(?:wounds|stress)"[\s\S]*?<\/button>/g)];
  assert.equal(bars.length, 2);
  assert.match(bars[0][0], /data-appearance-preview-target="bars"/);
  assert.match(bars[1][0], /data-appearance-preview-target="bars"/);
  assert.match(bars[0][0], /<strong>3<\/strong>/);
  assert.match(bars[1][0], /<strong>2<\/strong>/);
  assert.doesNotMatch(preview, /appearance-preview-bar-label|appearance-preview-zone|3\/10|2\/10|Ferimentos<\/span>|Estresses<\/span>/);
  assert.equal((bars[0][0].match(/<button/g) ?? []).length, 1);
  assert.equal((bars[1][0].match(/<button/g) ?? []).length, 1);
});

test("token-specific name popup uses the same compact appearance controls as room settings", () => {
  const popup = sheetHtml.match(/<dialog id="name-appearance-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
  assert.ok(popup.length > 0, "popup de nome do token encontrado");
  assert.match(popup, /appearance-editor-dialog token-name-appearance-dialog/);
  for (const id of ["token-name-size", "token-name-color", "token-name-font", "token-name-alignment", "token-name-visible"]) {
    assert.match(popup, new RegExp(`id="${id}"`));
  }
  assert.match(popup, /Padrão da sala/);
  assert.match(popup, /Tamanho <output id="token-name-size-value"/);
  assert.match(popup, /Fonte padrão/);
  assert.match(popup, /Times New Roman/);
  assert.match(popup, /Nome à esquerda/);
  assert.doesNotMatch(popup, /Estas opções afetam somente|As opções iniciais acompanham/);
  assert.doesNotMatch(popup, /<p>/);
});

test("unnecessary static help copy is removed from ficha dialogs", () => {
  assert.doesNotMatch(sheetHtml, /Gerencie os dados deste personagem/);
  assert.doesNotMatch(sheetHtml, /Defina os limites deste personagem e ajuste os valores crônicos/);
  assert.doesNotMatch(sheetHtml, /Estas opções afetam somente o nome deste token/);
  assert.match(sheetHtml, /Os dados da ficha serão removidos deste token/);
  assert.match(sheetHtml, />0\/0<\/button>/);
  assert.doesNotMatch(sheetHtml, /Ocupados: 0 \/ 0/);
});

test("legacy resource limits are still read by the scene overlay renderer", () => {
  assert.match(barRenderer, /saved\.resourceOneUnconsciousAt \?\? saved\.resourceOneMax/);
  assert.match(barRenderer, /saved\.resourceTwoUnconsciousAt \?\? saved\.resourceTwoMax/);
});
