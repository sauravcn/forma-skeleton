import manifest from "./navigation.manifest.json" with { type: "json" };
import english from "./messages/en.json" with { type: "json" };
import schema from "./navigation.schema.json" with { type: "json" };

export const navigationIcons = Object.freeze([
  ...schema.$defs.item.properties.icon.enum,
]);
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const hrefPattern = /^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?)?$/;
const visibilityPattern = /^[a-z][a-z0-9_.:-]*$/;
const itemKeys = new Set(Object.keys(schema.$defs.item.properties));
const requiredKeys = schema.$defs.item.required;
function fail(message) {
  throw new Error(`Invalid navigation manifest: ${message}`);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value, pattern, max) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    pattern.test(value)
  );
}
function keys(value, allowed, context) {
  if (!object(value)) fail(`${context} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) fail(`${context} has unknown key ${key}`);
}
function sortItems(a, b) {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function validateNavigation(value, messages = english) {
  keys(value, new Set(Object.keys(schema.properties)), "root");
  if (!object(messages)) fail("English message bindings must be an object");
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 100
  )
    fail("expected schemaVersion 1 and 1–100 items");
  const byId = new Map();
  for (const item of value.items) {
    keys(item, itemKeys, "item");
    if (requiredKeys.some((key) => !Object.hasOwn(item, key)))
      fail("item is missing required fields");
    if (!text(item.id, idPattern, 64) || byId.has(item.id))
      fail("IDs must be valid and unique");
    if (!text(item.href, hrefPattern, 240))
      fail(`${item.id} href must be a safe in-app absolute path`);
    if (
      !text(item.labelKey, /^[a-z][a-zA-Z0-9_.-]*$/, 120) ||
      !Object.hasOwn(messages, item.labelKey) ||
      typeof messages[item.labelKey] !== "string" ||
      !messages[item.labelKey].trim()
    )
      fail(`${item.id} labelKey must resolve to an English text message`);
    if (!navigationIcons.includes(item.icon))
      fail(`${item.id} icon binding is not registered`);
    if (!schema.$defs.item.properties.group.enum.includes(item.group))
      fail(`${item.id} group must be main or resources`);
    if (!Number.isInteger(item.order) || item.order < 0 || item.order > 10000)
      fail(`${item.id} order must be an integer from 0 to 10000`);
    if (item.parent !== null && !text(item.parent, idPattern, 64))
      fail(`${item.id} parent must be null or an ID`);
    if (item.visibility !== undefined) {
      keys(
        item.visibility,
        new Set(["allPermissions", "allFeatures"]),
        `${item.id} visibility`,
      );
      for (const field of ["allPermissions", "allFeatures"]) {
        const list = item.visibility[field];
        if (
          list !== undefined &&
          (!Array.isArray(list) ||
            list.length > 30 ||
            list.some((key) => !text(key, visibilityPattern, 100)) ||
            new Set(list).size !== list.length)
        )
          fail(`${item.id} ${field} must contain unique visibility keys`);
      }
    }
    byId.set(item.id, item);
  }
  for (const item of value.items) {
    const seen = new Set();
    let current = item;
    while (current) {
      if (seen.has(current.id)) fail(`${item.id} hierarchy contains a cycle`);
      seen.add(current.id);
      if (seen.size > 8) fail(`${item.id} hierarchy exceeds eight levels`);
      if (current.parent === null) break;
      const parent = byId.get(current.parent);
      if (!parent) fail(`${current.id} has an unknown parent`);
      if (parent.group !== current.group)
        fail(`${current.id} and parent must use the same navigation group`);
      current = parent;
    }
  }
  return value.items.map((item) => structuredClone(item)).sort(sortItems);
}
export const navigation = validateNavigation(manifest);

export function navigationLabelKey(page, items = navigation) {
  const active = items.find((item) => item.id === page);
  if (active) return active.labelKey;
  const fixedPages = new Map([
    ["overview", "nav.overview"],
    ["records", "nav.records"],
    ["configuration", "nav.configuration"],
  ]);
  return fixedPages.get(page) || "app.workspace";
}

// Visibility is a presentation filter, never a trusted identity/authorization check.
export function visibleNavigation(items = navigation, context = {}) {
  if (!Array.isArray(items))
    fail("visible items must be an array of validated entries");
  const byId = new Map(items.map((item) => [item.id, item])),
    memo = new Map(),
    active = new Set();
  const safeContext = object(context) ? context : {};
  const permissions = new Set(
      Array.isArray(safeContext.permissions) ? safeContext.permissions : [],
    ),
    flags = object(safeContext.featureFlags) ? safeContext.featureFlags : {};
  function visible(item) {
    if (memo.has(item.id)) return memo.get(item.id);
    if (active.has(item.id)) fail("visible hierarchy contains a cycle");
    active.add(item.id);
    const rule = item.visibility || {};
    const allowed =
      (rule.allPermissions || []).every((key) => permissions.has(key)) &&
      (rule.allFeatures || []).every(
        (key) => Object.hasOwn(flags, key) && flags[key] === true,
      );
    const parent = item.parent === null ? null : byId.get(item.parent);
    const result =
      allowed && (item.parent === null || (!!parent && visible(parent)));
    active.delete(item.id);
    memo.set(item.id, result);
    return result;
  }
  return items.filter(visible).sort(sortItems);
}
export function navigationFor(
  layout,
  position,
  items = navigation,
  context = {},
) {
  if (!["sidebar", "top", "combined"].includes(layout))
    throw new Error("Unsupported navigation layout");
  if (!["sidebar", "top", "mobile"].includes(position))
    throw new Error("Unsupported navigation region");
  const visible = visibleNavigation(items, context);
  if (position === "mobile") return visible;
  if (layout === "combined")
    return visible.filter((item) =>
      position === "top" ? item.group === "resources" : item.group === "main",
    );
  return layout === position ? visible : [];
}
export function navigationTree(items) {
  const nodes = new Map(
      items.map((item) => [
        item.id,
        { ...structuredClone(item), children: [] },
      ]),
    ),
    roots = [];
  for (const item of [...items].sort(sortItems)) {
    const node = nodes.get(item.id);
    if (item.parent === null) roots.push(node);
    else if (nodes.has(item.parent)) nodes.get(item.parent).children.push(node);
  }
  return roots;
}
export function recordStats(records) {
  const completed = records.filter((record) => record.status === "done").length;
  return {
    total: records.length,
    completed,
    open: records.length - completed,
    progress: records.length ? completed / records.length : 0,
  };
}
