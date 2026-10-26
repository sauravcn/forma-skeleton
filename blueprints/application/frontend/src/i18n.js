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
  validateCatalog(messages);
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

// Validate catalog shape without treating translated text as a route/record identity.
export function validateCatalog(messages, baseline = english) {
  if (!messages || typeof messages !== "object" || Array.isArray(messages))
    throw new Error("Invalid catalog");
  const tokens = (text) =>
    [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)]
      .map((m) => m[1])
      .sort()
      .join(",");
  for (const [key, value] of Object.entries(messages)) {
    if (!Object.hasOwn(baseline, key)) throw new Error("Unknown catalog key");
    const original = baseline[key];
    if (typeof original === "string") {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        tokens(value) !== tokens(original)
      )
        throw new Error("Catalog placeholder mismatch");
    } else {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof value.other !== "string"
      )
        throw new Error("Plural catalog requires other");
      const allowed = new Set(["zero", "one", "two", "few", "many", "other"]);
      for (const [category, text] of Object.entries(value))
        if (
          !allowed.has(category) ||
          typeof text !== "string" ||
          !text.trim() ||
          tokens(text) !== tokens(original.other)
        )
          throw new Error("Plural placeholder mismatch");
    }
  }
  return true;
}
