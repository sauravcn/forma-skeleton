import english from "./messages/en.json" with { type: "json" };
export function translate(
  key,
  values = {},
  messages = english,
  locale = "en-US",
) {
  let value = messages[key] ?? english[key];
  if (value && typeof value === "object") {
    const category = new Intl.PluralRules(locale).select(Number(values.count));
    value = value[category] ?? value.other;
  }
  if (typeof value !== "string") throw new Error(`Unknown message: ${key}`);
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
export function localization(locale = "en-US", messages = english) {
  return {
    t: (key, values) => translate(key, values, messages, locale),
    number: (value, options) =>
      new Intl.NumberFormat(locale, options).format(value),
    date: (value) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
  };
}
