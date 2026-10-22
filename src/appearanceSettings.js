export const DEFAULT_APPEARANCE_SETTINGS = Object.freeze({
  woundsColor: "#c84b56",
  stressColor: "#397fc4",
  woundsBackgroundColor: "#d9878d",
  stressBackgroundColor: "#87b3e2",
  barSize: "small",
  barAlignment: "center",
  barTextColor: "#ffffff",
  barFont: "sans-serif",
  defenseSize: "small",
  defenseAlignment: "center",
  defenseColor: "#ffffff",
  defenseFont: "sans-serif",
  evasionBackgroundColor: "#7198c8",
  protectionBackgroundColor: "#70a783",
  convictionBackgroundColor: "#ac913e",
  nameSizePercent: 0,
  nameAlignment: "center",
  nameColor: "#000000",
  nameFont: "sans-serif",
  barPlacement: "bottom",
  namePlacement: "bottom",
});

const ALLOWED_FONTS = Object.freeze([
  "sans-serif", "Arial", "serif", "Georgia", "Times New Roman",
  "monospace", "Courier New", "cursive",
]);

const LEGACY_FONTS = Object.freeze({
  "Roboto, sans-serif": "sans-serif",
  "Inter, sans-serif": "sans-serif",
  "Arial, sans-serif": "Arial",
  "Georgia, serif": "Georgia",
});

function validColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
}

function normalizeFont(value) {
  const candidate = LEGACY_FONTS[String(value ?? "")] ?? String(value ?? "");
  return ALLOWED_FONTS.includes(candidate) ? candidate : "sans-serif";
}

export function normalizeAppearanceSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const defaults = DEFAULT_APPEARANCE_SETTINGS;
  return {
    woundsColor: validColor(source.woundsColor === "#d9878d" ? "#c84b56" : source.woundsColor, defaults.woundsColor),
    stressColor: validColor(source.stressColor === "#87b3e2" ? "#397fc4" : source.stressColor, defaults.stressColor),
    woundsBackgroundColor: validColor(source.woundsBackgroundColor === "#b8737b" ? "#d9878d" : source.woundsBackgroundColor, defaults.woundsBackgroundColor),
    stressBackgroundColor: validColor(source.stressBackgroundColor === "#648db8" ? "#87b3e2" : source.stressBackgroundColor, defaults.stressBackgroundColor),
    barSize: source.barSize === "large" ? "large" : "small",
    barAlignment: ["left", "center", "right"].includes(source.barAlignment) ? source.barAlignment : defaults.barAlignment,
    barTextColor: validColor(source.barTextColor, defaults.barTextColor),
    barFont: normalizeFont(source.barFont),
    defenseSize: source.defenseSize === "large" ? "large" : "small",
    defenseAlignment: ["left", "center", "right"].includes(source.defenseAlignment) ? source.defenseAlignment : defaults.defenseAlignment,
    defenseColor: validColor(source.defenseColor, defaults.defenseColor),
    defenseFont: normalizeFont(source.defenseFont),
    evasionBackgroundColor: validColor(source.evasionBackgroundColor, defaults.evasionBackgroundColor),
    protectionBackgroundColor: validColor(source.protectionBackgroundColor, defaults.protectionBackgroundColor),
    convictionBackgroundColor: validColor(source.convictionBackgroundColor, defaults.convictionBackgroundColor),
    nameSizePercent: Number.isFinite(Number(source.nameSizePercent)) ? Math.max(0, Math.min(100, Number(source.nameSizePercent))) : (source.nameSize === "small" ? 35 : 0),
    nameAlignment: ["left", "center", "right"].includes(source.nameAlignment) ? source.nameAlignment : defaults.nameAlignment,
    nameColor: validColor(source.nameColor, defaults.nameColor),
    nameFont: normalizeFont(source.nameFont),
    barPlacement: source.barPlacement === "top" ? "top" : "bottom",
    namePlacement: source.namePlacement === "top" ? "top" : source.namePlacement === "bottom" ? "bottom" : (source.barPlacement === "top" ? "top" : "bottom"),
  };
}
