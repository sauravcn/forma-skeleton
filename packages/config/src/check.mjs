import fs from "node:fs";
import { defaultConfig, validateConfig } from "./index.mjs";
const blueprint = JSON.parse(
  fs.readFileSync(
    new URL("../../../blueprints/application/blueprint.json", import.meta.url),
  ),
);
const config = process.argv[2]
  ? JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  : defaultConfig();
try {
  console.log(JSON.stringify(validateConfig(config, blueprint), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
