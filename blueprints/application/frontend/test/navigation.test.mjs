import assert from "node:assert/strict";
import test from "node:test";
import manifest from "../src/navigation.manifest.json" with { type: "json" };
import {
  navigation,
  validateNavigation,
  visibleNavigation,
  navigationFor,
  navigationTree,
  navigationLabelKey,
} from "../src/navigation.js";
const fixture = () => structuredClone(manifest);
function invalid(edit) {
  const value = fixture();
  edit(value);
  assert.throws(() => validateNavigation(value), /Invalid navigation manifest/);
}

test("source manifest validates to deterministic copied entries with stable label-independent identities", () => {
  const value = fixture();
  value.items.reverse();
  const before = structuredClone(value);
  const entries = validateNavigation(value);
  assert.deepEqual(
    entries.map((item) => item.id),
    navigation.map((item) => item.id),
  );
  assert.deepEqual(value, before);
  entries[0].href = "/changed";
  assert.notEqual(value.items[2].href, "/changed");
  const translated = {
    "nav.overview": "Translated overview",
    "nav.records": "Translated records",
    "nav.configuration": "Translated guide",
  };
  assert.deepEqual(
    validateNavigation(value, translated).map((item) => item.id),
    navigation.map((item) => item.id),
  );
});
test("unsafe paths unknown fields and JSON-shaped code fail closed", () => {
  for (const href of [
    "javascript:alert(1)",
    "https://evil.example",
    "//evil.example",
    "/../admin",
    "/%2e%2e/admin",
    "/records?target=evil",
    "/records#code",
    "/records\\admin",
    "/records\n",
  ]) {
    invalid((value) => {
      value.items[0].href = href;
    });
  }
  invalid((value) => {
    value.run = "() => fetch('secret')";
  });
  invalid((value) => {
    value.items[0].component = "import('remote')";
  });
  invalid((value) => {
    value.items[0].visibility = { roles: ["admin"] };
  });
  assert.throws(
    () =>
      validateNavigation(
        JSON.parse('{"schemaVersion":1,"items":[],"__proto__":{"admin":true}}'),
      ),
    /Invalid navigation manifest/,
  );
});
test("IDs order labels and icon bindings must resolve to declared safe data", () => {
  invalid((value) => {
    value.items[1].id = value.items[0].id;
  });
  invalid((value) => {
    value.items[0].id = "Not-Stable";
  });
  invalid((value) => {
    value.items[0].order = "10";
  });
  invalid((value) => {
    value.items[0].order = -1;
  });
  invalid((value) => {
    value.items[0].labelKey = "unknown.copy";
  });
  invalid((value) => {
    value.items[0].labelKey = "app.recordsCount";
  });
  invalid((value) => {
    value.items[0].icon = "unregisteredIcon";
  });
  invalid((value) => {
    delete value.items[0].parent;
  });
  invalid((value) => {
    value.items = [];
  });
  invalid((value) => {
    value.items = Array.from({ length: 101 }, (_, i) => ({
      ...value.items[0],
      id: `entry-${i}`,
    }));
  });
});
test("hierarchy rejects unresolved parents cycles cross-group branches and excessive depth", () => {
  invalid((value) => {
    value.items[0].parent = "missing-parent";
  });
  invalid((value) => {
    value.items[0].parent = "records";
    value.items[1].parent = "overview";
  });
  invalid((value) => {
    value.items[1].parent = "configuration";
  });
  invalid((value) => {
    value.items = Array.from({ length: 9 }, (_, i) => ({
      ...value.items[0],
      id: `entry-${i}`,
      href: `/entry-${i}`,
      parent: i ? `entry-${i - 1}` : null,
      order: i,
    }));
  });
});
test("visibility requires explicit metadata context and hides descendants with a hidden parent", () => {
  const value = fixture();
  value.items[0].visibility = { allPermissions: ["records:read"] };
  value.items[1].parent = "overview";
  value.items[1].visibility = { allFeatures: ["records.enabled"] };
  const entries = validateNavigation(value),
    ids = (context) =>
      visibleNavigation(entries, context).map((item) => item.id);
  assert.deepEqual(ids({}), ["configuration"]);
  assert.deepEqual(ids(null), ["configuration"]);
  assert.deepEqual(ids({ featureFlags: { "records.enabled": true } }), [
    "configuration",
  ]);
  assert.deepEqual(ids({ permissions: ["records:read"] }), [
    "overview",
    "configuration",
  ]);
  assert.deepEqual(
    ids({
      permissions: ["records:read"],
      featureFlags: { "records.enabled": true },
    }),
    ["overview", "records", "configuration"],
  );
  assert.deepEqual(
    ids({
      permissions: ["records:read"],
      featureFlags: { "records.enabled": "true" },
    }),
    ["overview", "configuration"],
  );
  assert.deepEqual(
    ids({
      permissions: ["records:read"],
      featureFlags: Object.create({ "records.enabled": true }),
    }),
    ["overview", "configuration"],
  );
  invalid((data) => {
    data.items[0].visibility = {
      allPermissions: ["records:read", "records:read"],
    };
  });
  invalid((data) => {
    data.items[0].visibility = { allFeatures: "premium" };
  });
});
test("all layout regions preserve visible hierarchy and tree construction does not mutate entries", () => {
  const value = fixture();
  value.items[1].parent = "overview";
  value.items[1].order = 1;
  const entries = validateNavigation(value),
    before = structuredClone(entries);
  const tree = navigationTree(navigationFor("sidebar", "sidebar", entries));
  assert.deepEqual(
    tree.map((item) => item.id),
    ["overview", "configuration"],
  );
  assert.equal(tree[0].children[0].id, "records");
  assert.deepEqual(entries, before);
  for (const layout of ["sidebar", "top", "combined"]) {
    const regions = [
      ...navigationFor(layout, "sidebar", entries),
      ...navigationFor(layout, "top", entries),
    ];
    assert.deepEqual(
      regions.map((item) => item.id).sort(),
      entries.map((item) => item.id).sort(),
    );
    assert.equal(
      navigationTree(navigationFor(layout, "mobile", entries))[0].children[0]
        .id,
      "records",
    );
  }
  assert.throws(
    () => navigationFor("combined", "unregistered-region"),
    /Unsupported navigation region/,
  );
});

test("current-page labels follow manifest bindings with safe fixed-page fallback", () => {
  const value = fixture();
  value.items.find((item) => item.id === "records").labelKey = "guide.title";
  const entries = validateNavigation(value);
  assert.equal(navigationLabelKey("records", entries), "guide.title");
  assert.equal(
    navigationLabelKey(
      "records",
      entries.filter((item) => item.id !== "records"),
    ),
    "nav.records",
  );
  assert.equal(navigationLabelKey("unknown-page", entries), "app.workspace");
  assert.equal(navigationLabelKey("constructor", []), "app.workspace");
});
