import { en } from "./en.js";
const placeholders = (value) =>
  [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
export function identityMessages(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw new Error("Invalid identity catalog");
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(en, key) ||
      typeof value !== "string" ||
      !value.trim() ||
      JSON.stringify(placeholders(value)) !==
        JSON.stringify(placeholders(en[key]))
    )
      throw new Error("Identity catalog placeholder contract mismatch");
  }
  return { ...en, ...overrides };
}
export function identityText(message, values = {}) {
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, key) => {
    if (!Object.hasOwn(values, key))
      throw new Error("Missing identity interpolation value");
    return String(values[key]);
  });
}
