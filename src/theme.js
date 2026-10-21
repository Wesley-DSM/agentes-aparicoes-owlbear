const EXTENSION_ID = "com.agentesaparicoes.character-sheet";
export const THEME_STORAGE_KEY = `${EXTENSION_ID}/theme`;
export const THEME_CUSTOMIZATION_KEY = `${EXTENSION_ID}/theme-customization`;

export const DEFAULT_CUSTOM_THEME = Object.freeze({
  background: "#111111",
  surface: "#191919",
  field: "#101010",
  text: "#f2f2f2",
  muted: "#a7a7a7",
  accent: "#a72129",
  accentText: "#ffffff",
  heading: "#df6c70",
  border: "#333333",
  traitBackground: "#f08e8b",
  traitText: "#64181d",
  interfaceHighlight: "#579866",
  transparency: 0,
  radius: 8,
});

const COLOR_KEYS = [
  "background", "surface", "field", "text", "muted", "accent",
  "accentText", "heading", "border", "traitBackground", "traitText", "interfaceHighlight",
];

function normalizeChoice(value) {
  // Legacy "dark" preferences are migrated to the customizable dark theme.
  return value === "owlbear" ? "owlbear" : "custom";
}

export function normalizeCustomTheme(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const result = { ...DEFAULT_CUSTOM_THEME };
  for (const key of COLOR_KEYS) {
    if (/^#[0-9a-f]{6}$/i.test(String(source[key] ?? ""))) result[key] = String(source[key]).toLowerCase();
  }
  const transparency = Number(source.transparency);
  const radius = Number(source.radius);
  result.transparency = Number.isFinite(transparency) ? Math.max(0, Math.min(100, Math.round(transparency / 5) * 5)) : DEFAULT_CUSTOM_THEME.transparency;
  result.radius = Number.isFinite(radius) ? Math.max(0, Math.min(16, Math.round(radius))) : DEFAULT_CUSTOM_THEME.radius;
  return result;
}

function readChoice() {
  try { return normalizeChoice(localStorage.getItem(THEME_STORAGE_KEY)); } catch { return "custom"; }
}

function readCustomization() {
  try {
    const value = localStorage.getItem(THEME_CUSTOMIZATION_KEY);
    return normalizeCustomTheme(value ? JSON.parse(value) : DEFAULT_CUSTOM_THEME);
  } catch {
    return { ...DEFAULT_CUSTOM_THEME };
  }
}

function rgba(hex, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) return hex;
  const value = match[1];
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function isLightColor(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) return false;
  const channels = [0, 2, 4].map((start) => parseInt(match[1].slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 > 0.52;
}

function setCustomProperties(theme) {
  const root = document.documentElement;
  const transparency = theme.transparency / 100;
  root.style.setProperty("--aa-custom-bg", rgba(theme.background, 1 - transparency));
  root.style.setProperty("--aa-custom-surface", rgba(theme.surface, 1 - transparency * 0.5));
  root.style.setProperty("--aa-custom-field", rgba(theme.field, 1 - transparency * 0.25));
  root.style.setProperty("--aa-custom-text", theme.text);
  root.style.setProperty("--aa-custom-muted", theme.muted);
  root.style.setProperty("--aa-custom-accent", theme.accent);
  root.style.setProperty("--aa-custom-accent-text", theme.accentText);
  root.style.setProperty("--aa-custom-heading", theme.heading);
  root.style.setProperty("--aa-custom-border", rgba(theme.border, Math.max(0.35, 1 - transparency * 0.25)));
  root.style.setProperty("--aa-custom-trait-bg", theme.traitBackground);
  root.style.setProperty("--aa-custom-trait-text", theme.traitText);
  root.style.setProperty("--aa-custom-highlight", theme.interfaceHighlight);
  root.style.setProperty("--aa-custom-highlight-soft", rgba(theme.interfaceHighlight, 0.16));
  root.style.setProperty("--aa-custom-highlight-border", rgba(theme.interfaceHighlight, 0.62));
  root.style.setProperty("--aa-custom-accent-soft", rgba(theme.accent, 0.16));
  root.style.setProperty("--aa-custom-accent-border", rgba(theme.accent, 0.62));
  root.style.setProperty("--aa-custom-radius", `${theme.radius}px`);
  root.style.setProperty("--aa-custom-blur", theme.transparency > 0 ? "8px" : "0px");
  root.style.colorScheme = isLightColor(theme.background) ? "light" : "dark";
}

function setOwlbearProperties(theme) {
  const root = document.documentElement;
  const palette = theme && typeof theme === "object" ? theme : {};
  const primary = palette.primary ?? {};
  const secondary = palette.secondary ?? {};
  const background = palette.background ?? {};
  const text = palette.text ?? {};
  root.style.setProperty("--aa-owl-bg", background.default || "#222630");
  root.style.setProperty("--aa-owl-paper", background.paper || "#2c313d");
  root.style.setProperty("--aa-owl-input", background.default || "#20242d");
  root.style.setProperty("--aa-owl-primary", primary.main || "#687bb8");
  root.style.setProperty("--aa-owl-primary-text", primary.contrastText || "#ffffff");
  root.style.setProperty("--aa-owl-secondary", secondary.main || "#7b84a0");
  root.style.setProperty("--aa-owl-secondary-text", secondary.contrastText || primary.contrastText || "#ffffff");
  root.style.setProperty("--aa-owl-text", text.primary || "#f0f1f4");
  root.style.setProperty("--aa-owl-muted", text.secondary || "#b5bac6");
  root.style.setProperty("--aa-owl-disabled", text.disabled || "#858a96");
  root.style.colorScheme = palette.mode === "LIGHT" ? "light" : "dark";
}

function applySavedTheme(owlbearPalette) {
  const choice = readChoice();
  const root = document.documentElement;
  root.dataset.aaTheme = choice;
  if (choice === "owlbear") {
    setOwlbearProperties(owlbearPalette);
  } else {
    setCustomProperties(readCustomization());
  }
  return choice;
}

export function createThemeController() {
  let hostTheme = null;
  let unsubscribeTheme = null;

  const apply = () => applySavedTheme(hostTheme);
  apply();

  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === THEME_STORAGE_KEY || event.key === THEME_CUSTOMIZATION_KEY) apply();
  });

  return {
    apply,
    getChoice: readChoice,
    getCustomization: readCustomization,
    setChoice(value) {
      const choice = normalizeChoice(value);
      try { localStorage.setItem(THEME_STORAGE_KEY, choice); } catch { /* local theme is optional */ }
      apply();
      return choice;
    },
    updateCustomization(partial) {
      const next = normalizeCustomTheme({ ...readCustomization(), ...(partial || {}) });
      try { localStorage.setItem(THEME_CUSTOMIZATION_KEY, JSON.stringify(next)); } catch { /* local theme is optional */ }
      apply();
      return next;
    },
    resetCustomization() {
      const next = { ...DEFAULT_CUSTOM_THEME };
      try { localStorage.setItem(THEME_CUSTOMIZATION_KEY, JSON.stringify(next)); } catch { /* local theme is optional */ }
      apply();
      return next;
    },
    connect(OBR) {
      if (!OBR?.theme) return;
      try {
        Promise.resolve(OBR.theme.getTheme()).then((theme) => {
          hostTheme = theme;
          apply();
        }).catch((error) => console.debug("A&A: usando a paleta Owlbear padrão.", error));
        unsubscribeTheme = OBR.theme.onChange((theme) => {
          hostTheme = theme;
          apply();
        });
      } catch (error) {
        console.debug("A&A: não foi possível ler o tema Owlbear.", error);
      }
    },
    disconnect() {
      if (typeof unsubscribeTheme === "function") unsubscribeTheme();
      unsubscribeTheme = null;
    },
  };
}
