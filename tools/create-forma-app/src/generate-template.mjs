import path from "node:path";
import { packageRoot, destinationPath, writePlan } from "./generate.mjs";
import {
  catalogIds,
  validTemplateId,
  readBundledTemplate,
} from "./templates.mjs";
export async function generateTemplate(id, destination, options = {}) {
  if (!validTemplateId(id)) throw new Error(`Unknown app template: ${id}`);
  const root = options.bundleRoot || path.join(packageRoot, "bundle");
  const ids = await catalogIds(path.join(root, "templates"), {
    optional: true,
  });
  if (!ids.includes(id))
    throw Error(
      `Unknown app template: ${id}; not bundled in this distribution`,
    );
  const template = await readBundledTemplate(root, id).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        `App template ${id} is not bundled in this distribution; request a catalog-enabled package`,
      );
    throw error;
  });
  const output = await destinationPath(destination);
  return writePlan(
    {
      ...output,
      files: template.files,
      config: { template: id, ...template.selection },
    },
    options,
  );
}
