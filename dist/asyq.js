#!/usr/bin/env node

// src/asyq.ts
import { Command } from "commander";
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
import * as p from "@clack/prompts";
import pc from "picocolors";

// src/scan.ts
import fs from "fs";
import path from "path";
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify"
]);
var ENV_KEY_RE_STRICT = /^[A-Z][A-Z0-9_]*$/;
var ENV_KEY_RE_LOOSE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function scanProjectForEnvKeys(opts) {
  const root = opts.rootDir;
  const maxCtx = opts.maxContextPerKey ?? 2;
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
  const contexts = {};
  let filesScanned = 0;
  const seenInCode = /* @__PURE__ */ new Set();
  walk(root);
  const finalKeys = /* @__PURE__ */ new Set();
  const seenInCodeUpper = new Set([...seenInCode].map((k) => k.toUpperCase()));
  for (const key of keys) {
    if (seenInCodeUpper.has(key.toUpperCase())) {
      finalKeys.add(key);
    }
  }
  for (const codeKey of seenInCode) {
    const upper = codeKey.toUpperCase();
    let found = false;
    for (const key of finalKeys) {
      if (key.toUpperCase() === upper) {
        found = true;
        break;
      }
    }
    if (!found && keyOk(codeKey)) {
      finalKeys.add(codeKey);
    }
  }
  return { keys: finalKeys, filesScanned, contexts };
  function addCtx(key, relFile, line, snippet) {
    if (!contexts[key]) contexts[key] = [];
    if (contexts[key].length >= maxCtx) return;
    contexts[key].push({
      file: relFile,
      line,
      snippet: snippet.trim().slice(0, 220)
    });
  }
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
        continue;
      }
      const isEnvFile = entry.name === ".env" || entry.name.startsWith(".env.");
      const ext = path.extname(entry.name);
      if (!isEnvFile && !exts.has(ext)) continue;
      const content = safeRead(full);
      if (!content) continue;
      filesScanned++;
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (isEnvFile) {
        extractFromEnvFile(content, rel, keys, addCtx, keyOk);
      } else {
        extractFromCode(content, rel, keys, seenInCode, addCtx, keyOk);
      }
    }
  }
}
function extractFromEnvFile(text, relFile, keys, addCtx, keyOk) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim() || ln.trim().startsWith("#")) continue;
    const m = ln.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue;
    const k = m[1];
    if (!keyOk(k)) continue;
    keys.add(k);
    addCtx(k, relFile, i + 1, ln);
  }
}
function extractFromCode(text, relFile, keys, seenInCode, addCtx, keyOk) {
  const lines = text.split(/\r?\n/);
  const patterns = [
    // process.env.KEY or process?.env?.KEY
    /\bprocess(?:\?\.|\.)env(?:\?\.|\.)([A-Za-z_][A-Za-z0-9_]*)\b/gi,
    // process.env["KEY"] or process?.env?.["KEY"]
    /\bprocess(?:\?\.|\.)env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/gi,
    // import.meta.env.KEY (Vite, etc.)
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/gi,
    // Deno.env.get("KEY")
    /\bDeno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/gi,
    // Bun.env.KEY
    /\bBun\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/gi
  ];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim().startsWith("//") || ln.trim().startsWith("#")) continue;
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while (match = re.exec(ln)) {
        const k = match[1];
        if (!keyOk(k)) continue;
        keys.add(k);
        seenInCode.add(k);
        addCtx(k, relFile, i + 1, ln);
      }
    }
  }
}
function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// src/ai.ts
var JSON_SCHEMA = {
  name: "env_docs",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            description: { type: "string" },
            where_to_get: { type: "string" },
            example_value: { type: "string" },
            is_secret: { type: "boolean" }
          },
          required: [
            "key",
            "description",
            "where_to_get",
            "example_value",
            "is_secret"
          ]
        }
      }
    },
    required: ["items"]
  }
};
function buildInput(opts) {
  const lines = opts.keys.map((k) => {
    const ctx = opts.contexts[k]?.[0];
    const seenAt = ctx ? `${ctx.file}:${ctx.line}` : "unknown";
    const snippet = ctx ? ctx.snippet : "";
    return `- ${k}
  seen_at: ${seenAt}
  snippet: ${snippet}`;
  });
  const system = [
    "You generate documentation for environment variables.",
    "Return ONLY JSON that matches the provided JSON Schema.",
    "Do not include markdown or extra text.",
    "Never output real secrets. Use safe placeholders.",
    "Keep descriptions short and practical.",
    "where_to_get must be actionable (dashboard, secret manager, CI, local service, etc.)."
  ].join(" ");
  const user = [
    opts.projectHint ? `Project hint: ${opts.projectHint}` : "",
    "Variables:",
    ...lines
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}
function extractTextFromResponses(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim())
    return data.output_text;
  const out = data?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === "string" && c.text.trim()) return c.text;
      }
    }
  }
  return "";
}
function tryParseJsonLoose(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
async function generateEnvDocsWithOpenAI(opts) {
  const input = buildInput(opts);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: opts.model,
      input,
      text: {
        format: {
          type: "json_schema",
          ...JSON_SCHEMA
        }
      }
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const raw = extractTextFromResponses(data).trim();
  const parsed = tryParseJsonLoose(raw);
  if (!parsed) {
    throw new Error(
      "AI output was not valid JSON. Try again, or use a different model."
    );
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return items.map((x) => ({
    key: String(x.key ?? ""),
    description: String(x.description ?? ""),
    where_to_get: String(x.where_to_get ?? ""),
    example_value: String(x.example_value ?? ""),
    is_secret: Boolean(x.is_secret)
  })).filter((x) => x.key.length > 0);
}

// src/asyq.ts
var MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano"
];
function getPackageVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path2.dirname(__filename);
    const pkgPath = path2.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
function fail(message) {
  p.outro(pc.red(message));
  process.exit(1);
}
async function pickMode() {
  const mode = await p.select({
    message: "How would you like to generate .env.example?",
    options: [
      { label: "Default (fast)", value: "default" },
      { label: "AI-assisted (adds descriptions)", value: "ai" }
    ]
  });
  if (p.isCancel(mode)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return mode;
}
async function pickModel() {
  const model = await p.select({
    message: "Select an AI model",
    initialValue: "gpt-4.1-mini",
    options: MODELS.map((m) => ({ label: m, value: m }))
  });
  if (p.isCancel(model)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return model;
}
async function getApiKey() {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;
  const key = await p.password({
    message: "Enter OpenAI API key (not saved)",
    validate: (v) => v.trim().length > 0 ? void 0 : "API key cannot be empty"
  });
  if (p.isCancel(key)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return key.trim();
}
function readWorkspaceGlobs(rootAbs) {
  const globs = [];
  const pnpmWs = path2.join(rootAbs, "pnpm-workspace.yaml");
  if (fs2.existsSync(pnpmWs)) {
    const txt = fs2.readFileSync(pnpmWs, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
      if (m) globs.push(m[1].trim());
    }
  }
  const pkgPath = path2.join(rootAbs, "package.json");
  if (fs2.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf8"));
      const ws = pkg?.workspaces;
      if (Array.isArray(ws)) globs.push(...ws);
      if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages);
    } catch {
    }
  }
  return [...new Set(globs)].filter(Boolean);
}
function expandSimpleGlob(rootAbs, pattern) {
  const norm = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm.includes("*")) {
    const abs = path2.join(rootAbs, norm);
    return fs2.existsSync(abs) && fs2.statSync(abs).isDirectory() ? [norm] : [];
  }
  const m = norm.match(/^([^*]+)\/\*$/);
  if (!m) return [];
  const baseRel = m[1].replace(/\/+$/, "");
  const baseAbs = path2.join(rootAbs, baseRel);
  if (!fs2.existsSync(baseAbs) || !fs2.statSync(baseAbs).isDirectory()) return [];
  const out = [];
  for (const name of fs2.readdirSync(baseAbs)) {
    const rel = `${baseRel}/${name}`;
    const abs = path2.join(rootAbs, rel);
    if (!fs2.statSync(abs).isDirectory()) continue;
    if (fs2.existsSync(path2.join(abs, "package.json"))) out.push(rel);
  }
  return out;
}
function detectWorkspaces(rootAbs) {
  const globs = readWorkspaceGlobs(rootAbs);
  const found = /* @__PURE__ */ new Set();
  for (const g of globs) {
    for (const rel of expandSimpleGlob(rootAbs, g)) found.add(rel);
  }
  if (found.size === 0) {
    for (const base of ["apps", "packages"]) {
      const baseAbs = path2.join(rootAbs, base);
      if (!fs2.existsSync(baseAbs) || !fs2.statSync(baseAbs).isDirectory())
        continue;
      for (const name of fs2.readdirSync(baseAbs)) {
        const rel = `${base}/${name}`;
        const abs = path2.join(rootAbs, rel);
        if (!fs2.statSync(abs).isDirectory()) continue;
        if (fs2.existsSync(path2.join(abs, "package.json"))) found.add(rel);
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}
async function pickWorkspaces(workspaces) {
  const picked = await p.multiselect({
    message: "Select workspaces to generate .env.example for",
    options: workspaces.map((w) => ({ label: w, value: w })),
    required: false
  });
  if (p.isCancel(picked)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return picked ?? [];
}
var program = new Command();
program.name("asyq").description("Generate .env.example by scanning your project for env usage").version(`v${getPackageVersion()}`);
program.command("init").description("Scan project and generate .env.example").option("--root <dir>", "Project root to scan", ".").option("--out <file>", "Output file name", ".env.example").option("--force", "Overwrite output if it exists").option(
  "--include-lowercase",
  "Include lowercase/mixed-case keys (not recommended)"
).option("--debug", "Print scan diagnostics").option("--monorepo", "Generate .env.example for root + each workspace").option(
  "--select",
  "In monorepo mode: interactively choose which workspaces to generate for"
).option(
  "--workspaces <list>",
  "In monorepo mode: comma-separated workspace list to generate for"
).option("--no-root", "In monorepo mode: skip generating for repo root").action(async (opts) => {
  p.intro(pc.cyan(`
Asyq CLI v${getPackageVersion()} Created by @thev1ndu`));
  const rootAbs = path2.resolve(process.cwd(), opts.root);
  const outName = String(opts.out || ".env.example");
  const mode = await pickMode();
  const model = mode === "ai" ? await pickModel() : null;
  const targets = [];
  if (opts.root !== false) {
    targets.push({ label: "root", dirAbs: rootAbs });
  }
  if (opts.monorepo) {
    const workspaces = detectWorkspaces(rootAbs);
    if (workspaces.length === 0) {
      p.note(
        "No workspaces detected (pnpm-workspace.yaml / package.json workspaces / apps/* / packages/*).",
        "Monorepo"
      );
    } else {
      let selected = workspaces;
      if (opts.workspaces) {
        const allow = new Set(
          String(opts.workspaces).split(",").map((s) => s.trim()).filter(Boolean)
        );
        selected = workspaces.filter((w) => allow.has(w));
        const missing = [...allow].filter((x) => !workspaces.includes(x));
        if (missing.length) {
          p.note(missing.join("\n"), "Unknown workspaces ignored");
        }
      } else if (opts.select) {
        selected = await pickWorkspaces(workspaces);
      }
      for (const rel of selected) {
        targets.push({ label: rel, dirAbs: path2.join(rootAbs, rel) });
      }
    }
  }
  if (targets.length === 0) {
    fail(
      "No targets selected. Tip: remove --no-root or select at least one workspace."
    );
  }
  let apiKey = "";
  if (mode === "ai" && model) {
    apiKey = await getApiKey();
    if (!apiKey) fail("OpenAI API key is required for AI-assisted mode.");
  }
  const results = [];
  for (const t of targets) {
    const outFileAbs = path2.join(t.dirAbs, outName);
    const outRelFromRoot = path2.relative(rootAbs, outFileAbs).replace(/\\/g, "/") || outName;
    if (fs2.existsSync(outFileAbs) && !opts.force) {
      fail(
        `Output already exists: ${outRelFromRoot}. Use --force to overwrite.`
      );
    }
    const s = p.spinner();
    s.start(`Scanning ${t.label} for environment variables`);
    const res = scanProjectForEnvKeys({
      rootDir: t.dirAbs,
      includeLowercase: !!opts.includeLowercase
    });
    s.stop(
      `Scan complete: ${t.label} (${res.filesScanned} files, ${res.keys.size} keys)`
    );
    if (opts.debug) {
      p.note(
        [
          `dir: ${t.dirAbs}`,
          `files scanned: ${res.filesScanned}`,
          `keys found: ${res.keys.size}`
        ].join("\n"),
        `${t.label} diagnostics`
      );
    }
    if (res.keys.size === 0) {
      p.note(
        `No env vars detected in ${t.label}. Skipping ${outRelFromRoot}`,
        "Nothing to write"
      );
      results.push({
        target: t.label,
        outRel: outRelFromRoot,
        keys: 0,
        files: res.filesScanned,
        wrote: false
      });
      continue;
    }
    const keys = [...res.keys].sort((a, b) => a.localeCompare(b));
    let content = keys.map((k) => `${k}=`).join("\n") + "\n";
    if (mode === "ai" && model) {
      const aiSpinner = p.spinner();
      aiSpinner.start(`Writing .env.example documentation for ${t.label}`);
      try {
        const docs = await generateEnvDocsWithOpenAI({
          apiKey,
          model,
          projectHint: "Write practical guidance for developers setting env vars.",
          contexts: res.contexts,
          keys
        });
        aiSpinner.stop(
          `Documented ${keys.length} env variables for ${t.label}`
        );
        const byKey = new Map(docs.map((d) => [d.key, d]));
        content = keys.map((k) => {
          const d = byKey.get(k);
          if (!d) return `${k}=
`;
          const secretNote = d.is_secret ? "Secret value. Do not commit." : "Non-secret value (verify before committing).";
          return [
            `# ${d.key}`,
            `# ${d.description}`,
            `# Where to get it: ${d.where_to_get}`,
            `# ${secretNote}`,
            `${d.key}=${d.example_value || ""}`,
            ""
          ].join("\n");
        }).join("\n").trimEnd() + "\n";
      } catch (e) {
        aiSpinner.stop(`Failed to write documentation for ${t.label}`);
        fail(e?.message ?? String(e));
      }
    }
    fs2.writeFileSync(outFileAbs, content, "utf8");
    results.push({
      target: t.label,
      outRel: outRelFromRoot,
      keys: keys.length,
      files: res.filesScanned,
      wrote: true
    });
  }
  const summary = results.map((r) => {
    const status = r.wrote ? pc.green("wrote") : pc.yellow("skipped");
    return `${pc.cyan(r.target.padEnd(20))} ${pc.green(
      String(r.keys).padStart(3)
    )} keys \u2192 ${pc.dim(r.outRel)} ${pc.dim(`(${status})`)}`;
  }).join("\n");
  p.note(summary, "Generated");
  p.outro(pc.green("\u2713 All done!"));
});
program.parse(process.argv);
//# sourceMappingURL=asyq.js.map