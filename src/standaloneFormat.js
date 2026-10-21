const FORMAT_NAME = "agentes-aparicoes-sheet";

function safeJson(value) {
  return JSON.stringify(value, null, 2)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function removeElement(html, tagName, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`<${tagName}\\b(?=[^>]*\\bid=["']${escapedId}["'])[^>]*>[\\s\\S]*?<\\/${tagName}>\\s*`, "i"), "");
}

export function buildStandaloneHtml({ template, styles, runtime, payload }) {
  if (![template, styles, runtime].every((value) => typeof value === "string")) {
    throw new TypeError("Template, CSS e runtime são necessários para gerar a ficha HTML.");
  }
  const initialData = safeJson(payload);
  let html = template
    .replace("<title>Ficha A&A</title>", "<title>Ficha A&amp;A</title>")
    .replace('id="app" class="sheet-page not-ready"', 'id="app" class="sheet-page standalone-sheet"')
    .replace(/<button id="reset-sheet"[\s\S]*?<\/button>/i,
      '<button id="save-standalone-sheet" class="reset-sheet-button sheet-options-button standalone-save-button" type="button" title="Salvar ficha">Salvar</button>')
    .replace(/<div class="sheet-actions">[\s\S]*?<\/div>\s*/i, "")
    .replace(/<button id="toggle-token-name"[\s\S]*?<\/button>\s*/i, "")
    .replace(/<input id="import-sheet-file"[^>]*>\s*/i, "")
    .replace(/<section class="notice" id="notice"[^>]*>[\s\S]*?<\/section>/i,
      '<section class="notice" id="notice" role="status" aria-live="polite">Ficha independente. Clique em Salvar para baixar a versão atualizada.</section>');

  for (const dialogId of ["sheet-options-dialog", "reset-sheet-dialog", "delete-token-dialog"]) {
    html = removeElement(html, "dialog", dialogId);
  }

  const scriptPattern = /<script type="module" src="\.\/src\/sheet\.js"><\/script>/i;
  if (!scriptPattern.test(html)) throw new Error("Não foi possível preparar o modelo HTML da ficha.");
  const embedded = `<style>\n${styles}\n.standalone-sheet{width:100%;max-width:480px}.standalone-save-button{flex:0 0 auto;width:auto;min-width:66px;padding:0 10px;font-size:11px;font-weight:750}.standalone-sheet .skill-roll-button{cursor:default}.standalone-sheet .skill-roll-button:hover{border-color:transparent;background:transparent}\n</style>\n<script id="aa-sheet-data" type="application/json">${initialData}</script>\n<script>\n${runtime}\n</script>`;
  html = html.replace(scriptPattern, embedded);

  if (!html.includes('id="aa-sheet-data"') || !html.includes('id="save-standalone-sheet"') || !html.includes("standalone-sheet")) {
    throw new Error("O arquivo HTML gerado não contém os componentes necessários.");
  }
  return html.startsWith("<!doctype html>") ? html : `<!doctype html>\n${html}`;
}

export function extractSheetFromImport(text, filename = "") {
  if (typeof text !== "string" || !text.trim()) throw new Error("O arquivo está vazio.");
  let parsed;
  const looksLikeHtml = /\.html?$/i.test(filename) || /<!doctype\s+html|<html\b/i.test(text) || /id=["']aa-sheet-data["']/i.test(text);
  if (looksLikeHtml) {
    const match = text.match(/<script\b(?=[^>]*\bid=["']aa-sheet-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error("Este HTML não contém dados de uma ficha A&A exportada pela extensão.");
    parsed = JSON.parse(match[1]);
  } else {
    parsed = JSON.parse(text);
  }

  const candidate = parsed?.format === FORMAT_NAME
    ? parsed.sheet
    : (parsed?.sheet && typeof parsed.sheet === "object" ? parsed.sheet : parsed);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("O arquivo não contém uma ficha válida.");
  }
  const recognizedFields = ["characterName", "skills", "inventory", "powers", "rituals", "resourceOneNormal", "resourceTwoNormal", "evasion", "protection", "conviction"];
  if (!recognizedFields.some((key) => Object.prototype.hasOwnProperty.call(candidate, key))) {
    throw new Error("Este arquivo não parece ser uma ficha exportada de Agentes & Aparições.");
  }
  return candidate;
}
