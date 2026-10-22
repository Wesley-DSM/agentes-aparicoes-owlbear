import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings } from "../src/appearanceSettings.js";

test("appearance defaults remain stable for old or missing room settings", () => {
  assert.deepEqual(normalizeAppearanceSettings(null), { ...DEFAULT_APPEARANCE_SETTINGS });
  assert.equal(normalizeAppearanceSettings({}).nameFont, "sans-serif");
  assert.equal(normalizeAppearanceSettings({}).barPlacement, "bottom");
  assert.equal(normalizeAppearanceSettings({}).namePlacement, "bottom");
});

test("appearance normalization validates colors, fonts, alignments and size", () => {
  const normalized = normalizeAppearanceSettings({
    woundsColor: "not-a-color",
    barFont: "Comic Sans Definitely Not Allowed",
    nameFont: "Arial, sans-serif",
    nameAlignment: "diagonal",
    nameSizePercent: 130,
    barPlacement: "middle",
    namePlacement: "middle",
  });
  assert.equal(normalized.woundsColor, DEFAULT_APPEARANCE_SETTINGS.woundsColor);
  assert.equal(normalized.barFont, "sans-serif");
  assert.equal(normalized.nameFont, "Arial");
  assert.equal(normalized.nameAlignment, "center");
  assert.equal(normalized.nameSizePercent, 100);
  assert.equal(normalized.barPlacement, "bottom");
  assert.equal(normalized.namePlacement, "bottom");
});

test("legacy appearance colors and percent-based name size are preserved", () => {
  const normalized = normalizeAppearanceSettings({
    woundsColor: "#d9878d",
    stressColor: "#87b3e2",
    woundsBackgroundColor: "#b8737b",
    stressBackgroundColor: "#648db8",
    nameSizePercent: 63,
  });
  assert.equal(normalized.woundsColor, "#c84b56");
  assert.equal(normalized.stressColor, "#397fc4");
  assert.equal(normalized.woundsBackgroundColor, "#d9878d");
  assert.equal(normalized.stressBackgroundColor, "#87b3e2");
  assert.equal(normalized.nameSizePercent, 63);
});
