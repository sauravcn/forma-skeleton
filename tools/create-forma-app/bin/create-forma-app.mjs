#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { defaultConfig, generate } from "../src/generate.mjs";
import { generateTemplate } from "../src/generate-template.mjs";
import { templates } from "../src/templates.mjs";
export const help = `create-forma-app [destination] [--yes] [--id slug] [--name text]\n  [--navigation sidebar|top|combined] [--theme linen|midnight]\n  [--template field-service|accounting-studio|table-kitchen|clinic-desk|client-studio|care-center]\n  [--profile public|password-totp] [--config app.config.json] [--dry-run]\n\nGenerates a public synthetic starter by default, or password+mandatory-TOTP source with --profile password-totp.\nApp templates preserve their stable IDs/base paths and require password+TOTP; destination names do not rename the app. Neutral-only flags cannot override app templates. Live providers are absent; explicitly configured local development MOCK providers are available at runtime. Live mail, production readiness, hosting and purchase entitlement are not implied.\nUse --yes for explicit defaults in noninteractive scripts. Existing destinations are refused.\n`;
export async function configFromAnswers(options, ask) {
  let destination = options.destination;
  if (!destination)
    destination = options.yes
      ? "sample-app"
      : await ask("Project directory", "sample-app");
  const inferred = path.basename(destination),
    initial = options.configFile
      ? JSON.parse(await fs.readFile(options.configFile, "utf8"))
      : defaultConfig(options.id || inferred, options.name || "Sample App");
  const config = structuredClone(initial);
  for (const [key, label, fallback] of [
    ["id", "Stable app ID", config.id],
    ["name", "App display name", config.name],
    [
      "navigation",
      "Navigation (sidebar/top/combined)",
      config.navigation?.layout,
    ],
    ["theme", "Theme (linen/midnight)", config.theme?.preset],
  ]) {
    let value = options[key];
    if (value === undefined && !options.yes && !options.configFile)
      value = await ask(label, fallback);
    if (value !== undefined) {
      if (key === "navigation")
        config.navigation = { ...config.navigation, layout: value };
      else if (key === "theme")
        config.theme = { ...config.theme, preset: value };
      else config[key] = value;
    }
  }
  if (options.profile !== undefined) {
    if (!["public", "password-totp"].includes(options.profile))
      throw new Error("Unknown source profile");
    const auth =
      options.profile === "public"
        ? { mode: "none", providers: [], twoFactor: false }
        : { mode: "password", providers: [], twoFactor: true };
    if (
      options.configFile &&
      (config.auth?.mode !== auth.mode ||
        config.auth?.twoFactor !== auth.twoFactor ||
        !Array.isArray(config.auth?.providers) ||
        config.auth.providers.length !== 0)
    )
      throw new Error("Explicit profile conflicts with config authentication");
    config.auth = auth;
  }
  return { config, destination };
}
export function parseArgs(argv) {
  const result = { yes: false, dryRun: false };
  const valued = {
    "--id": "id",
    "--name": "name",
    "--navigation": "navigation",
    "--theme": "theme",
    "--config": "configFile",
    "--profile": "profile",
    "--template": "template",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--yes" || arg === "-y") result.yes = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--version") result.version = true;
    else if (arg in valued) {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Expected a value after ${arg}`);
      result[valued[arg]] = value;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (result.destination)
      throw new Error("Only one project destination is supported");
    else result.destination = arg;
  }
  return result;
}
export async function main(
  argv = process.argv.slice(2),
  input = process.stdin,
  output = process.stdout,
) {
  const options = parseArgs(argv);
  if (options.help) {
    output.write(help);
    return;
  }
  if (options.version) {
    output.write("0.1.0\n");
    return;
  }
  const interactive = !!input.isTTY && !!output.isTTY;
  if (!interactive && !options.destination && !options.yes)
    throw new Error("A destination is required with noninteractive --config");
  if (!interactive && !options.yes && !options.configFile)
    throw new Error(
      "Noninteractive generation requires --yes or --config; pass --help for supported options",
    );
  let reader;
  const ask = async (label, fallback) => {
    reader ??= createInterface({ input, output });
    return (
      (await reader.question(`${label} [${fallback}]: `)).trim() || fallback
    );
  };
  if (options.template !== undefined) {
    if (!templates.includes(options.template))
      throw new Error(`Unknown app template: ${options.template}`);
    for (const key of [
      "id",
      "name",
      "navigation",
      "theme",
      "configFile",
      "profile",
    ])
      if (options[key] !== undefined)
        throw new Error(
          `--template cannot be combined with neutral starter option ${key}`,
        );
    let result;
    try {
      const destination =
        options.destination ||
        (options.yes
          ? options.template
          : await ask("Project directory", options.template));
      result = await generateTemplate(options.template, destination, {
        dryRun: options.dryRun,
      });
    } finally {
      reader?.close();
    }
    output.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  let requested;
  try {
    requested = await configFromAnswers(options, ask);
  } finally {
    reader?.close();
  }
  const result = await generate(requested.config, requested.destination, {
    dryRun: options.dryRun,
  });
  output.write(JSON.stringify(result, null, 2) + "\n");
}
const invokedFile = process.argv[1]
  ? await fs.realpath(process.argv[1]).catch(() => null)
  : null;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href)
  main().catch((error) => {
    console.error(`create-forma-app: ${error.message}`);
    process.exitCode = 1;
  });
