import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CUSTOM_THEME, normalizeCustomTheme } from "../src/theme.js";

test("personalized theme falls back to the current dark palette", () => {
  const theme = normalizeCustomTheme({});
  assert.equal(theme.background, "#111111");
  assert.equal(theme.surface, "#191919");
  assert.equal(theme.accent, "#a72129");
  assert.equal(theme.traitBackground, "#f08e8b");
  assert.equal(theme.transparency, 0);
  assert.equal(theme.radius, 8);
});

test("personalized theme accepts custom colors and clamps finish controls", () => {
  const theme = normalizeCustomTheme({
    background: "#ffffff",
    heading: "#112233",
    traitText: "#223344",
    transparency: 37,
    radius: 25,
  });
  assert.equal(theme.background, "#ffffff");
  assert.equal(theme.heading, "#112233");
  assert.equal(theme.traitText, "#223344");
  assert.equal(theme.transparency, 35);
  assert.equal(theme.radius, 16);
});

test("invalid theme colors use safe defaults", () => {
  const theme = normalizeCustomTheme({ background: "red", accent: "#abc", heading: null });
  assert.equal(theme.background, DEFAULT_CUSTOM_THEME.background);
  assert.equal(theme.accent, DEFAULT_CUSTOM_THEME.accent);
  assert.equal(theme.heading, DEFAULT_CUSTOM_THEME.heading);
});
