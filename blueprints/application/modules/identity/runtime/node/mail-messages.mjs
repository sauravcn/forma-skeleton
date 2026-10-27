import english from "./mail-messages.en-US.json" with { type: "json" };
export function mailMessages(catalog = english) {
  if (
    !catalog ||
    Object.keys(catalog).sort().join(",") !== "reset,verification"
  )
    throw new Error("Complete verification/reset message catalog required");
  const copy = {};
  for (const kind of ["verification", "reset"]) {
    const message = catalog[kind];
    if (!message || Object.keys(message).sort().join(",") !== "subject,text")
      throw new Error("Whole email subject/text messages required");
    for (const field of ["subject", "text"]) {
      const value = message[field];
      if (
        typeof value !== "string" ||
        !value ||
        value.length > (field === "subject" ? 200 : 5000) ||
        [...value.matchAll(/\{([^{}]+)\}/g)].some(
          (match) => !["appName", "url"].includes(match[1]),
        )
      )
        throw new Error("Invalid email message catalog");
    }
    if (
      /[\r\n]/.test(message.subject) ||
      message.subject.includes("{url}") ||
      message.text.split("{url}").length !== 2
    )
      throw new Error("Token URL belongs exactly once in email body");
    copy[kind] = { ...message };
  }
  return Object.freeze(copy);
}
export function renderMail(kind, { appName, url }, catalog = mailMessages()) {
  if (
    !Object.hasOwn(catalog, kind) ||
    typeof appName !== "string" ||
    !appName.trim() ||
    appName.length > 120 ||
    /[\r\n\0]/.test(appName) ||
    typeof url !== "string"
  )
    throw new Error("Invalid email rendering context");
  const result = {};
  for (const field of ["subject", "text"])
    result[field] = catalog[kind][field].replace(
      /\{(appName|url)\}/g,
      (_, name) => (name === "appName" ? appName : url),
    );
  return result;
}
