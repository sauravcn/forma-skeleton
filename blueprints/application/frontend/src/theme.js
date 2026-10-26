export const presets = {
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
export function themeStyle(theme) {
  if (!presets[theme?.preset]) throw new Error("Unsupported theme preset");
  const tokens = { ...presets[theme.preset], ...theme.tokens };
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      `--app-${key}`,
      key === "radius" ? `${value}px` : value,
    ]),
  );
}
