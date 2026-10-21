import { resolveSkillReference } from "./inlineRolls.js";

const MEDIA_PATTERN = /^\[\[(https?:\/\/[^\]\s]+)\]\]$/i;
const INLINE_REFERENCE_PATTERN = /^\[\[\s*(?!https?:\/\/)([^\]]+?)\s*\]\]$/i;
const INLINE_PATTERN = /(\[\[(?:https?:\/\/[^\]\s]+)\]\]|\[\[\s*(?!https?:\/\/)[^\]\n]+?\s*\]\]|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function normalizedInlineLabel(value) {
  const content = String(value ?? "").replace(/^@/, "").trim();
  const dice = content.match(/^(\d{1,2})\s*d\s*10$/i);
  return dice ? `${Number(dice[1])}d10` : content;
}

function inlineRollDice(roll) {
  return (Array.isArray(roll?.dice) ? roll.dice : []).map((die) => {
    if (Number.isInteger(die)) return die;
    if (Array.isArray(die?.rolls) && die.rolls.length) return die.rolls[die.rolls.length - 1];
    if (Array.isArray(die) && die.length) return die[die.length - 1];
    return null;
  }).filter(Number.isInteger);
}

function appendInlineRollReference(parent, token, context) {
  const match = token.match(INLINE_REFERENCE_PATTERN);
  if (!match) {
    parent.append(document.createTextNode(token));
    return;
  }

  const sourceLabel = match[1].trim();
  const label = normalizedInlineLabel(sourceLabel);
  const diceFormula = /^\d{1,2}\s*d\s*10$/i.test(sourceLabel);
  const isSkillRoll = sourceLabel.startsWith("@");

  // In sheet descriptions, an unprefixed skill reference is a live value, not a roll.
  if (Array.isArray(context.skillValues) && !diceFormula && !isSkillRoll) {
    const skillReference = resolveSkillReference(sourceLabel, context.skillValues);
    if (skillReference) {
      const value = document.createElement("span");
      value.className = "inline-roll-reference inline-skill-value";
      value.textContent = String(skillReference.value);
      value.title = `${skillReference.skill.name}${skillReference.passive ? " Passiva" : ""}: ${skillReference.value}`;
      parent.append(value);
      return;
    }
  }

  // Plain [[Skill]] and [[Skill Passiva]] expressions are not rolls, so they
  // must not shift the index used to pair later roll tags with their results.
  if (!diceFormula && !isSkillRoll) {
    const reference = document.createElement("span");
    reference.className = "inline-roll-reference";
    reference.textContent = label;
    reference.title = "Referência inline";
    parent.append(reference);
    return;
  }

  const index = context.rollIndex++;
  const roll = context.inlineRolls[index];
  if (!roll || !context.showInlineResults) {
    const reference = document.createElement("span");
    reference.className = "inline-roll-reference";
    reference.textContent = label;
    reference.title = isSkillRoll ? "Rolagem de perícia inline" : "Rolagem inline";
    parent.append(reference);
    return;
  }

  const values = inlineRollDice(roll);
  if (!values.length) {
    const reference = document.createElement("span");
    reference.className = "inline-roll-reference";
    reference.textContent = label;
    parent.append(reference);
    return;
  }
  const results = document.createElement("span");
  results.className = "inline-roll-inline-results";
  results.setAttribute("aria-label", `${label}: ${values.join(", ")}`);
  values.forEach((value, dieIndex) => {
    const die = document.createElement("button");
    die.type = "button";
    die.className = value === 10 ? "inline-roll-inline-die inline-roll-inline-die-ten" : "inline-roll-inline-die";
    die.textContent = String(value);
    die.title = context.entryId ? `Rerrolar o dado ${dieIndex + 1}` : `${label}: ${value}`;
    die.setAttribute("aria-label", `${label}, dado ${dieIndex + 1}: ${value}`);
    if (context.entryId) {
      die.dataset.inlineRollEntry = String(context.entryId);
      die.dataset.inlineRollIndex = String(index);
      die.dataset.inlineDieIndex = String(dieIndex);
    } else {
      die.disabled = true;
    }
    results.append(die);
  });
  parent.append(results);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function appendImage(parent, urlText) {
  const url = safeUrl(urlText);
  if (!url) {
    parent.append(document.createTextNode(`[[${urlText}]]`));
    return;
  }

  const link = document.createElement("a");
  link.className = "ability-description-media-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = "Abrir imagem em uma nova aba";

  const image = document.createElement("img");
  image.className = "ability-description-image";
  image.src = url;
  image.alt = "Imagem ou GIF do texto";
  image.loading = "eager";
  image.decoding = "async";
  image.addEventListener("error", () => {
    const fallback = document.createElement("span");
    fallback.className = "ability-description-media-fallback";
    fallback.textContent = `Não foi possível carregar a imagem: ${url}`;
    link.replaceWith(fallback);
  }, { once: true });
  link.append(image);
  parent.append(link);
}

function appendInline(parent, source, context = { rollIndex: 0, inlineRolls: [], showInlineResults: false }) {
  const text = String(source ?? "");
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    const media = token.match(MEDIA_PATTERN);
    if (media) {
      appendImage(parent, media[1]);
    } else if (token.startsWith("[[") && token.endsWith("]]")) {
      appendInlineRollReference(parent, token, context);
    } else {
      const markdownLink = token.match(/^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/i);
      if (markdownLink) {
        const url = safeUrl(markdownLink[2]);
        if (url) {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          anchor.textContent = markdownLink[1];
          parent.append(anchor);
        } else {
          parent.append(document.createTextNode(token));
        }
      } else {
        let tagName = "span";
        let content = token;
        if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
          tagName = "strong";
          content = token.slice(2, -2);
        } else if (token.startsWith("~~") && token.endsWith("~~")) {
          tagName = "del";
          content = token.slice(2, -2);
        } else if (token.startsWith("`") && token.endsWith("`")) {
          tagName = "code";
          content = token.slice(1, -1);
        } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
          tagName = "em";
          content = token.slice(1, -1);
        }
        const element = document.createElement(tagName);
        element.textContent = content;
        parent.append(element);
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

export function renderInlineMarkdown(container, source) {
  container.replaceChildren();
  appendInline(container, String(source ?? ""), { rollIndex: 0, inlineRolls: [], showInlineResults: false });
}

export function renderFormattedMarkdown(container, source, options = {}) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  container.replaceChildren();
  if (!text) return;

  const context = {
    rollIndex: 0,
    inlineRolls: Array.isArray(options.inlineRolls) ? options.inlineRolls : [],
    showInlineResults: Boolean(options.showInlineResults),
    entryId: options.entryId ?? "",
    skillValues: Array.isArray(options.skillValues) ? options.skillValues : null,
  };

  let paragraph = [];
  let list = null;
  let listType = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    paragraph.forEach((line, index) => {
      if (index) p.append(document.createElement("br"));
      appendInline(p, line, context);
    });
    container.append(p);
    paragraph = [];
  };
  const closeList = () => {
    list = null;
    listType = null;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const h = document.createElement(`h${heading[1].length}`);
      appendInline(h, heading[2], context);
      container.append(h);
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      const blockquote = document.createElement("blockquote");
      appendInline(blockquote, quote[1], context);
      container.append(blockquote);
      continue;
    }

    const unordered = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (!list || listType !== nextType) {
        closeList();
        list = document.createElement(nextType);
        listType = nextType;
        container.append(list);
      }
      const li = document.createElement("li");
      appendInline(li, (unordered || ordered)[1], context);
      list.append(li);
      continue;
    }

    closeList();
    paragraph.push(line);
  }
  flushParagraph();
}

export function containsMarkdown(source) {
  const text = String(source ?? "");
  return /\[\[https?:\/\/[^\]\s]+\]\]|\[\[\s*(?!https?:\/\/)[^\]\n]+?\s*\]\]|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|(^|[^\w])\*[^*\s][^*\n]*\*(?=$|[^\w])|(^|[^\w])_[^_\s][^_\n]*_(?=$|[^\w])|^\s{0,3}#{1,3}\s|^\s{0,3}[-*+]\s+|^\s{0,3}\d+[.)]\s+|^\s{0,3}>\s?/m.test(text);
}
