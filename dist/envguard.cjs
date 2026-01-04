#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/envguard.ts
var import_commander = require("commander");
var import_node_fs2 = __toESM(require("fs"), 1);
var import_node_path2 = __toESM(require("path"), 1);
var import_picocolors = __toESM(require("picocolors"), 1);

// src/scan.ts
var import_node_fs = __toESM(require("fs"), 1);
var import_node_path = __toESM(require("path"), 1);
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache"
]);
var ENV_KEY_RE_STRICT = /^[A-Z][A-Z0-9_]*$/;
var ENV_KEY_RE_LOOSE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function scanProjectForEnvKeys(opts) {
  const root = opts.rootDir;
  const keyOk = (k) => (opts.includeLowercase ? ENV_KEY_RE_LOOSE : ENV_KEY_RE_STRICT).test(k);
  const exts = /* @__PURE__ */ new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".toml"
  ]);
  const keys = /* @__PURE__ */ new Set();
  let filesScanned = 0;
  walk(root);
  return { keys, filesScanned };
  function walk(dir) {
    let entries;
    try {
      entries = import_node_fs.default.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = import_node_path.default.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
        continue;
      }
      const isEnvFile = entry.name === ".env" || entry.name.startsWith(".env.");
      const ext = import_node_path.default.extname(entry.name);
      if (!isEnvFile && !exts.has(ext)) continue;
      const content = safeRead(full);
      if (!content) continue;
      filesScanned++;
      if (isEnvFile) {
        extractFromEnvFile(content, keys, keyOk);
      } else {
        extractFromCodeAndConfigs(content, keys, keyOk);
      }
    }
  }
}
function extractFromEnvFile(text, keys, keyOk) {
  for (const m of text.matchAll(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
}
function extractFromCodeAndConfigs(text, keys, keyOk) {
  for (const m of text.matchAll(
    /\bprocess(?:\?\.)?\.env(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)\b/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
  for (const m of text.matchAll(
    /\bprocess(?:\?\.)?\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
  for (const m of text.matchAll(
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
  for (const m of text.matchAll(
    /\bDeno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
}
function safeRead(filePath) {
  try {
    return import_node_fs.default.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// src/envguard.ts
function header(title, subtitle) {
  console.log(import_picocolors.default.bold(title));
  if (subtitle) console.log(import_picocolors.default.dim(subtitle));
  console.log("");
}
function line(label, value) {
  console.log(`  ${import_picocolors.default.dim(label)} ${value}`);
}
var program = new import_commander.Command();
program.name("envguard").description(
  "Generate a .env.example file by scanning your project for env usage"
).version("1.0.1");
program.command("init").description("Scan project and generate .env.example with KEY= lines").option("--root <dir>", "Project root to scan", ".").option("--out <file>", "Output file", ".env.example").option("--force", "Overwrite output if it exists").option(
  "--include-lowercase",
  "Also include lowercase/mixed-case keys (not recommended)"
).option("--debug", "Print scan diagnostics").action((opts) => {
  header("envguard", "Initializing environment template");
  const root = import_node_path2.default.resolve(process.cwd(), opts.root);
  const outFile = import_node_path2.default.resolve(process.cwd(), opts.out);
  if (import_node_fs2.default.existsSync(outFile) && !opts.force) {
    console.error(import_picocolors.default.red(`Output already exists: ${opts.out}`));
    console.error(import_picocolors.default.dim("Use --force to overwrite."));
    process.exit(1);
  }
  const res = scanProjectForEnvKeys({
    rootDir: root,
    includeLowercase: !!opts.includeLowercase
  });
  if (opts.debug) {
    line("root:", opts.root);
    line("files scanned:", String(res.filesScanned));
    line("keys found:", String(res.keys.size));
    console.log("");
  }
  if (res.keys.size === 0) {
    console.error(import_picocolors.default.red("No env keys found."));
    console.error(
      import_picocolors.default.dim(
        "Make sure your code uses process.env.KEY or configs use ${KEY}."
      )
    );
    console.error(
      import_picocolors.default.dim("If this is a monorepo, try --root apps or --root packages.")
    );
    process.exit(1);
  }
  const sorted = [...res.keys].sort((a, b) => a.localeCompare(b));
  const content = sorted.map((k) => `${k}=`).join("\n") + "\n";
  import_node_fs2.default.writeFileSync(outFile, content, "utf8");
  console.log(import_picocolors.default.green("Success"));
  line("created:", opts.out);
  line("keys:", String(sorted.length));
  console.log("");
  console.log(import_picocolors.default.dim("Next steps"));
  console.log(import_picocolors.default.dim(`  1) Fill values in ${opts.out}`));
  console.log(import_picocolors.default.dim("  2) Copy to .env (do not commit secrets)"));
});
program.parse(process.argv);
