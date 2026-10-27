import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  packageRoot,
  destinationPath,
  writePlan,
  readBundle,
} from "./generate.mjs";
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function validateDefinition(input) {
  const value = structuredClone(input);
  if (
    value?.schemaVersion !== 1 ||
    Object.keys(value).some(
      (key) =>
        ![
          "schemaVersion",
          "id",
          "name",
          "nameKey",
          "pythonModule",
          "webPort",
          "apiPort",
          "theme",
          "navigation",
          "navigationLayout",
          "labels",
        ].includes(key),
    ) ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    typeof value.nameKey !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value.nameKey) ||
    value.pythonModule !== "forma_" + value.id.replaceAll("-", "_") ||
    ![value.webPort, value.apiPort].every(
      (port) => Number.isInteger(port) && port >= 1024 && port <= 65535,
    ) ||
    value.webPort === value.apiPort ||
    !["sidebar", "top", "combined"].includes(value.navigationLayout) ||
    !value.theme ||
    typeof value.theme.name !== "string" ||
    !value.theme.tokens ||
    typeof value.theme.tokens !== "object" ||
    Array.isArray(value.theme.tokens) ||
    !Array.isArray(value.navigation) ||
    value.navigation.length < 1 ||
    !value.labels ||
    typeof value.labels !== "object" ||
    Array.isArray(value.labels)
  )
    throw Error("Invalid workspace-domain definition");
  const ids = new Set();
  for (const item of value.navigation) {
    if (
      !item ||
      Object.keys(item).some((k) => !["id", "labelKey", "icon"].includes(k)) ||
      !/^[a-z][a-z0-9-]*$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.labelKey !== "string" ||
      typeof value.labels[item.labelKey] !== "string" ||
      item.icon !== "layers"
    )
      throw Error("Invalid workspace navigation definition");
    ids.add(item.id);
  }
  for (const [key, label] of Object.entries(value.labels))
    if (
      !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key) ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 2000
    )
      throw Error("Invalid English localization proposal");
  if (typeof value.labels[value.nameKey] !== "string")
    throw Error("App name requires an English key");
  value.labels[value.id + ".scaffold.pending"] ||=
    "Domain workflows are not implemented yet. This is an authoring scaffold.";
  for (const [key, token] of Object.entries(value.theme.tokens))
    if (
      !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) ||
      typeof token !== "string" ||
      !token ||
      token.length > 200 ||
      /[{};<>\n\r]/.test(token) ||
      /url\s*\(/i.test(token)
    )
      throw Error("Invalid theme token");
  return value;
}
export async function generateWorkspaceDomain(
  input,
  destination,
  options = {},
) {
  const definition = validateDefinition(input),
    output = await destinationPath(destination);
  const bundle = await readBundle();
  const root = path.join(bundle.root, "domain-workspace");
  const files = new Map(),
    sourceFiles = {};
  const add = (name, bytes, origin = "generated-domain-definition") => {
    if (files.has(name)) throw Error("Workspace scaffold source collision");
    files.set(name, { bytes: Buffer.from(bytes), origin });
  };
  async function copy(dir, prefix = "") {
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error("Workspace blueprint must be real source");
    for (const name of (await fs.readdir(dir)).sort()) {
      if (name === "blueprint.json" && !prefix) continue;
      if (
        [".git", "node_modules", ".next", "__pycache__", "data"].includes(
          name,
        ) ||
        /\.(?:pyc|db|sqlite3?|key|pem)$/.test(name) ||
        name.startsWith(".env")
      )
        throw Error("Runtime/private artifact in workspace blueprint");
      const original = prefix ? prefix + "/" + name : name,
        relative = original.replaceAll(
          "__PYTHON_MODULE__",
          definition.pythonModule,
        ),
        full = path.join(dir, name),
        entry = await fs.lstat(full);
      if (entry.isSymbolicLink())
        throw Error("Workspace blueprint symlinks refused");
      if (entry.isDirectory()) await copy(full, original);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(full);
        sourceFiles[original] = digest(bytes);
        if (
          bundle.provenance.files["domain-workspace/" + original] !==
          sourceFiles[original]
        )
          throw Error("Workspace blueprint source is not pinned");
        add(relative, bytes, "domain-workspace/" + original);
      } else throw Error("Invalid workspace blueprint entry");
    }
  }
  const blueprint = JSON.parse(
    await fs.readFile(path.join(root, "blueprint.json"), "utf8"),
  );
  if (
    blueprint.id !== "forma.domain-workspace" ||
    blueprint.version !== "0.1.0"
  )
    throw Error("Unsupported workspace blueprint");
  await copy(root);
  const id = definition.id,
    mod = definition.pythonModule,
    frontend = "apps/" + id + "/frontend",
    backend = "apps/" + id + "/backend";
  const manifest = {
    schemaVersion: 1,
    id,
    name: definition.name,
    basePath: "/" + id,
    auth: "password-totp",
    collectionUrl: false,
    navigationLayout: definition.navigationLayout,
  };
  add("frontend/src/foundation.manifest.json", json(manifest));
  add("frontend/src/navigation.manifest.json", json(definition.navigation));
  add(
    "frontend/src/foundation.config.js",
    `import manifest from './foundation.manifest.json';\nimport navigation from './navigation.manifest.json';\nexport const appTheme=${json(definition.theme).trim()};\nexport default {...manifest,navigation,brandLabelKey:${JSON.stringify(definition.nameKey)},iconBindings:${JSON.stringify([...new Set(definition.navigation.map((item) => item.icon))])}};\n`,
  );
  const dependencies = {
    next: "16.4.2",
    react: "19.3.1",
    "react-dom": "19.3.1",
    "lucide-react": "0.468.0",
    "@forma/ui": "0.1.0",
    "@forma/localization": "0.1.0",
    "@forma/api-client": "0.1.0",
    "@forma/workspace-ui": "0.1.0",
    "@forma/app-foundation": "0.1.0",
    "@forma/standalone-identity": "0.1.0",
  };
  add(
    "frontend/package.json",
    json({
      name: "@forma/" + id,
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        dev: `next dev --hostname 127.0.0.1 --port ${definition.webPort}`,
        build: "next build",
        start: `next start --hostname 127.0.0.1 --port ${definition.webPort}`,
      },
      dependencies,
    }),
  );
  add(
    "frontend/next.config.mjs",
    `import {fileURLToPath} from 'node:url';\nconst root=fileURLToPath(new URL('../../../',import.meta.url));\nexport default {poweredByHeader:false,basePath:${JSON.stringify("/" + id)},output:'standalone',outputFileTracingRoot:root,turbopack:{root},transpilePackages:${JSON.stringify(Object.keys(dependencies).filter((k) => k.startsWith("@forma/")))}};\n`,
  );
  add(
    "backend/server.py",
    `import os\nfrom pathlib import Path\nfrom ${mod}.server import main\nif __name__ == '__main__':\n    os.environ.setdefault('DATABASE_PATH',str(Path(__file__).parent/'data/workspace.db'))\n    main()\n`,
  );
  add(
    `backend/${mod}/server.py`,
    `import os\nfrom pathlib import Path\nfrom forma_sdk.workspace import serve\nfrom .repository import Repository\ndef main():\n    serve(Repository(os.environ.get('DATABASE_PATH',Path.cwd()/'.forma-data/${id}/workspace.db')),${definition.apiPort},${definition.webPort})\nif __name__=='__main__':\n    main()\n`,
  );
  add(
    "backend/test_blueprint.py",
    `import unittest
from pathlib import Path
class BlueprintSourceTest(unittest.TestCase):
    def test_foundation_migration_retained(self):
        sql=(Path(__file__).parent/${JSON.stringify(mod)}/'migrations/001_foundation.sql').read_text()
        self.assertIn('domain_blueprint_state',sql)
if __name__=='__main__':
    unittest.main()
`,
  );
  add(
    "backend/pyproject.toml",
    `[build-system]\nrequires=["setuptools>=68"]\nbuild-backend="setuptools.build_meta"\n[project]\nname="forma-${id}-api"\nversion="0.1.0"\nrequires-python=">=3.11"\ndependencies=["forma-sdk==0.1.0"]\n[project.scripts]\nforma-${id}="${mod}.server:main"\n[tool.setuptools.packages.find]\ninclude=["${mod}*"]\n[tool.setuptools.package-data]\n${mod}=["migrations/*.sql"]\n`,
  );
  add(
    "registration.proposal.json",
    json({
      id,
      name: definition.name,
      nameKey: definition.nameKey,
      frontend,
      backend,
      backendEntry: "server.py",
      local: { webPort: definition.webPort, apiPort: definition.apiPort },
    }),
  );
  add("localization.proposal.json", json(definition.labels));
  add(
    "README.md",
    `# ${definition.name}\n\nGenerated authoring workspace from forma.domain-workspace ${blueprint.version}. Domain workflows are UNFINISHED.\n\nA maintainer must review registration.proposal.json, add frontend workspace/root install scripts, and merge localization.proposal.json into the complete English catalog. Shared foundation/identity/SDK packages must exist in the authoring workspace. This output alone is not a complete standalone customer app.\n\nKeep 001_foundation.sql immutable; add domain migrations from 002 onward. Replace repository hooks and src/main.jsx with tested business workflows. Run backend tests, independent frontend build, protected identity/role/API checks and actual browser acceptance before release. Export full physical dependencies with the application exporter for customer delivery. No real AI, payment, provider or production claim is implied.\n`,
  );
  const inventory = Object.fromEntries(
    [...files].map(([name, { bytes }]) => [name, digest(bytes)]),
  );
  add(
    "WORKSPACE_BLUEPRINT.json",
    json({
      schemaVersion: 1,
      blueprint,
      definition,
      definitionHash: digest(json(definition)),
      sourceFiles,
      sourceSnapshotHash: digest(json(sourceFiles)),
      snapshotHash: digest(json(inventory)),
      files: inventory,
      status: "unfinished-domain",
      generator: { name: "create-forma-app", version: "0.1.0" },
      repository: "https://github.com/sauravcn/forma-skeleton",
    }),
  );
  return writePlan(
    {
      ...output,
      files,
      config: { kind: "authoring-workspace", id, status: "unfinished-domain" },
    },
    options,
  );
}
