import registry from "./theme-tokens.json" with { type: "json" };
const presetOverrides = {
  linen: {
    accent: "#285b4c",
    background: "#f6f5f0",
    surface: "#ffffff",
    text: "#243c34",
    muted: "#66746e",
    border: "#dfe4dd",
    radius: 14,
    fontFamily: "Arial, Helvetica, sans-serif",
    onAccent: "#ffffff",
    soft: "#eaf0e8",
    sidebar: "#233e34",
    sidebarText: "#f3f5ee",
    highlight: "#dfbd79",
    error: "#a23232",
  },
  midnight: {
    accent: "#9cdbbf",
    background: "#121c26",
    surface: "#1b2a38",
    text: "#eef3f7",
    muted: "#b2c0cb",
    border: "#354858",
    radius: 10,
    fontFamily: "Arial, Helvetica, sans-serif",
    onAccent: "#142b21",
    soft: "#243b3c",
    sidebar: "#0c151e",
    sidebarText: "#eaf4f8",
    highlight: "#b4c5f4",
    error: "#ffb5b5",
  },
};
export const presets = Object.fromEntries(
  Object.entries(presetOverrides).map(([name, overrides]) => [
    name,
    Object.freeze({
      ...Object.fromEntries(
        Object.entries(registry).map(([key, definition]) => [
          key,
          definition.default,
        ]),
      ),
      ...overrides,
      focus: overrides.accent,
      success: overrides.accent,
    }),
  ]),
);
export function validateTheme(theme) {
  if (
    !theme ||
    typeof theme !== "object" ||
    Array.isArray(theme) ||
    Object.keys(theme).some((key) => !["preset", "tokens"].includes(key)) ||
    !Object.hasOwn(presets, theme.preset) ||
    !theme.tokens ||
    typeof theme.tokens !== "object" ||
    Array.isArray(theme.tokens)
  )
    throw new Error("Invalid parent theme");
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (!Object.hasOwn(registry, key))
      throw new Error("Unknown parent theme token");
    const schema = registry[key].schema;
    if (
      schema.type === "string"
        ? typeof value !== "string" ||
          (schema.minLength && value.length < schema.minLength) ||
          (schema.maxLength && value.length > schema.maxLength) ||
          !new RegExp(schema.pattern).test(value)
        : typeof value !== "number" ||
          !Number.isFinite(value) ||
          (schema.type === "integer" && !Number.isInteger(value)) ||
          value < schema.minimum ||
          value > schema.maximum
    )
      throw new Error("Invalid parent theme token value");
  }
  return { ...presets[theme.preset], ...theme.tokens };
}
export function themeStyle(theme) {
  const tokens = validateTheme(theme);
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      `--app-${key}`,
      registry[key].unit ? `${value}${registry[key].unit}` : value,
    ]),
  );
}
