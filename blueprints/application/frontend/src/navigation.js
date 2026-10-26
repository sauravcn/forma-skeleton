export const navigation = [
  {
    id: "overview",
    href: "/",
    labelKey: "nav.overview",
    icon: "overview",
    group: "main",
  },
  {
    id: "records",
    href: "/records",
    labelKey: "nav.records",
    icon: "records",
    group: "main",
  },
  {
    id: "configuration",
    href: "/configuration",
    labelKey: "nav.configuration",
    icon: "source",
    group: "resources",
  },
];
export function navigationFor(layout, position, items = navigation) {
  if (!["sidebar", "top", "combined"].includes(layout))
    throw new Error("Unsupported navigation layout");
  if (position === "mobile") return items;
  if (layout === "combined")
    return items.filter((item) =>
      position === "top" ? item.group === "resources" : item.group === "main",
    );
  return layout === position ? items : [];
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
