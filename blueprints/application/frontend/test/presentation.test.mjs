import assert from "node:assert/strict";
import test from "node:test";
import { localization, translate } from "../src/i18n.js";
import { navigation, navigationFor, recordStats } from "../src/navigation.js";
import { presets, themeStyle } from "../src/theme.js";

test("all navigation layouts retain stable routes without translating identities", () => {
  for (const layout of ["sidebar", "top", "combined"]) {
    const rendered = [
      ...navigationFor(layout, "sidebar"),
      ...navigationFor(layout, "top"),
    ];
    assert.deepEqual(
      rendered.map((item) => item.id).sort(),
      navigation.map((item) => item.id).sort(),
    );
    assert.equal(
      new Set(rendered.map((item) => item.id)).size,
      navigation.length,
    );
    assert.deepEqual(navigationFor(layout, "mobile"), navigation);
  }
  assert.throws(() => navigationFor("untrusted-layout", "top"));
});
test("parent theme overrides remain app-owned and do not mutate preset defaults", () => {
  const before = structuredClone(presets);
  const style = themeStyle({
    preset: "midnight",
    tokens: {
      accent: "#112233",
      radius: 22,
      fontFamily: "Verdana, sans-serif",
    },
  });
  assert.equal(style["--app-accent"], "#112233");
  assert.equal(style["--app-radius"], "22px");
  assert.equal(style["--app-fontFamily"], "Verdana, sans-serif");
  assert.notEqual(
    style["--app-background"],
    themeStyle({ preset: "linen", tokens: {} })["--app-background"],
  );
  assert.deepEqual(presets, before);
  assert.throws(() => themeStyle({ preset: "unknown", tokens: {} }));
});
test("locale fallback and plural interpolation preserve data and report missing contracts", () => {
  assert.equal(translate("nav.records", {}, {}), "Records");
  assert.equal(translate("app.recordsCount", { count: 1 }), "1 record");
  assert.equal(translate("app.recordsCount", { count: 3 }), "3 records");
  assert.equal(
    translate("records.revision", { revision: "<script>" }),
    "Revision <script>",
  );
  assert.throws(() => translate("missing.message"));
  assert.equal(localization().number(0.5, { style: "percent" }), "50%");
});
test("dashboard counts are derived from saved records and empty state never invents progress", () => {
  assert.deepEqual(recordStats([]), {
    total: 0,
    completed: 0,
    open: 0,
    progress: 0,
  });
  assert.deepEqual(
    recordStats([{ status: "todo" }, { status: "done" }, { status: "done" }]),
    { total: 3, completed: 2, open: 1, progress: 2 / 3 },
  );
});
