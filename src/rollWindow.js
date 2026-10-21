import OBR from "@owlbear-rodeo/sdk";

export const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
export const ROLL_CHANNEL = `${EXTENSION_ID}/skill-roll`;
export const ABILITY_CHANNEL = `${EXTENSION_ID}/ability-use`;
export const ROLL_POPOVER_ID = `${EXTENSION_ID}/skill-roll-result`;

let openQueue = Promise.resolve();

function smallestViewportDimension(values, fallback) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 100);
  return valid.length ? Math.min(...valid) : fallback;
}

export function openRollResultWindow(roll) {
  const operation = async () => {
    const url = new URL("./roll-result.html", window.location.href);
    url.searchParams.set("data", JSON.stringify(roll));
    const isAbility = roll?.type === "ability-use";
    const viewportWidth = smallestViewportDimension(
      [window.visualViewport?.width, window.innerWidth, window.screen?.availWidth],
      1024,
    );
    const viewportHeight = smallestViewportDimension(
      [window.visualViewport?.height, window.innerHeight, window.screen?.availHeight],
      900,
    );
    const targetWidth = isAbility ? 390 : 330;
    const width = Math.max(260, Math.min(targetWidth, Math.floor(viewportWidth - 20)));
    const description = String(roll?.description ?? "");
    const embeddedImages = [...description.matchAll(/\[\[https?:\/\/[^\]\s]+\]\]/gi)].length;
    const readableText = description
      .replace(/\[\[https?:\/\/[^\]\s]+\]\]/gi, "")
      .replace(/\[\[[^\]]+\]\]/g, "")
      .replace(/[`*_~#>]/g, "");
    const paragraphs = readableText.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
    const estimatedCharactersPerLine = width <= 310 ? 34 : width <= 350 ? 42 : 52;
    const estimatedTextLines = readableText.trim()
      ? readableText.split("\n").reduce((sum, line) => {
          return sum + Math.max(1, Math.ceil(line.trim().length / estimatedCharactersPerLine));
        }, 0)
      : 0;
    const traitsLength = Array.isArray(roll?.traits) ? roll.traits.reduce((sum, trait) => sum + String(trait).length, 0) : 0;
    const estimatedTraitRows = traitsLength ? Math.max(1, Math.ceil(traitsLength / estimatedCharactersPerLine)) : 0;
    const inlineRollCount = Array.isArray(roll?.inlineRolls) ? roll.inlineRolls.length : 0;
    const maxHeight = Math.max(220, Math.min(610, Math.floor(viewportHeight - 96)));
    const height = isAbility
      ? Math.max(100, Math.min(maxHeight, 100 + estimatedTextLines * 18 + Math.max(0, paragraphs.length - 1) * 5 + estimatedTraitRows * 23 + inlineRollCount * 48 + embeddedImages * 220))
      : Math.min(maxHeight, width <= 300 ? 158 : 148);
    const left = Math.max(8, Math.min(24, Math.floor(viewportWidth - width - 8)));
    const top = Math.max(8, Math.min(72, Math.floor(viewportHeight - height - 8)));

    // Reuse one small window so repeated rolls replace the previous result
    // instead of stacking popovers on top of one another.
    try {
      await OBR.popover.close(ROLL_POPOVER_ID);
    } catch {
      // It is normal for there to be no result window on the first roll.
    }

    await OBR.popover.open({
      id: ROLL_POPOVER_ID,
      url: url.href,
      width,
      height,
      anchorReference: "POSITION",
      anchorPosition: { left, top },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    });
  };

  openQueue = openQueue.then(operation, operation);
  return openQueue;
}

export function isSkillRoll(value) {
  return Boolean(
    value &&
      value.type === "skill-roll" &&
      typeof value.id === "string" &&
      typeof value.skillName === "string" &&
      typeof value.characterName === "string" &&
      typeof value.playerName === "string" &&
      Array.isArray(value.dice) &&
      value.dice.length >= 1 &&
      value.dice.length <= 5 &&
      value.dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 10),
  );
}

export function isAbilityUse(value) {
  return Boolean(
    value &&
      value.type === "ability-use" &&
      typeof value.id === "string" &&
      (value.kind === "power" || value.kind === "ritual") &&
      typeof value.abilityName === "string" &&
      value.abilityName.length > 0 &&
      value.abilityName.length <= 140 &&
      typeof value.description === "string" &&
      value.description.length <= 6000 &&
      typeof value.characterName === "string" &&
      typeof value.playerName === "string" &&
      Array.isArray(value.traits) &&
      value.traits.length <= 20 &&
      value.traits.every((trait) => typeof trait === "string" && trait.length <= 80),
  );
}
