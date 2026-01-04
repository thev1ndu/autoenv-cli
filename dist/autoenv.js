#!/usr/bin/env node

// src/autoenv.ts
import { Command } from "commander";
import fs2 from "fs";
import path2 from "path";
import pc from "picocolors";
import ora from "ora";
import boxen from "boxen";
import logUpdate from "log-update";
import TablePkg from "cli-table3";
import { select, password } from "@inquirer/prompts";

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
  ".cache"
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
  walk(root);
  return { keys, filesScanned, contexts };
  function addCtx(key, file, line, snippet) {
    if (!contexts[key]) contexts[key] = [];
    if (contexts[key].length >= maxCtx) return;
    contexts[key].push({
      file,
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
      if (isEnvFile) {
        extractFromEnvFile(content, entry.name, keys, addCtx, keyOk);
      } else {
        extractFromCodeAndConfigs(content, entry.name, keys, addCtx, keyOk);
      }
    }
  }
}
function extractFromEnvFile(text, fileName, keys, addCtx, keyOk) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue;
    const k = m[1];
    if (!keyOk(k)) continue;
    keys.add(k);
    addCtx(k, fileName, i + 1, ln);
  }
}
function extractFromCodeAndConfigs(text, fileName, keys, addCtx, keyOk) {
  const lines = text.split(/\r?\n/);
  const patterns = [
    /\bprocess(?:\?\.)?\.env(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\bprocess(?:\?\.)?\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\bDeno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g,
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  ];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while (match = re.exec(ln)) {
        const k = match[1];
        if (!keyOk(k)) continue;
        keys.add(k);
        addCtx(k, fileName, i + 1, ln);
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "AI output was not valid JSON (structured output expected)."
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

// src/autoenv.ts
var Table = TablePkg.default ?? TablePkg;
var MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano"
];
function renderHeader() {
  const body = [
    pc.bold("autoEnv"),
    pc.dim(""),
    pc.dim("Generate .env.example from your project\u2019s env usage"),
    pc.dim("Created by @thev1ndu")
  ].join("\n");
  console.log(
    boxen(body, {
      padding: 1,
      borderStyle: "round",
      borderColor: "cyan"
    })
  );
  console.log("");
}
function icon(status) {
  if (status === "done") return pc.green("\u2713");
  if (status === "fail") return pc.red("\u2717");
  if (status === "running") return pc.cyan("\u2022");
  return pc.dim("\u2022");
}
function renderSteps(steps) {
  logUpdate(
    steps.map((s) => {
      const left = `${icon(s.status)} ${s.title}`;
      const right = s.detail ? pc.dim(s.detail) : "";
      return right ? `${left} ${right}` : left;
    }).join("\n")
  );
}
function finishSteps() {
  logUpdate.done();
}
function fail(message, hint) {
  console.error(pc.red(message));
  if (hint) console.error(pc.dim(hint));
  process.exit(1);
}
async function pickMode() {
  return await select({
    message: "How would you like to generate .env.example?",
    choices: [
      { name: "Default", value: "default" },
      { name: "AI-assisted", value: "ai" }
    ]
  });
}
async function pickModel() {
  return await select({
    message: "Select an AI model",
    default: "gpt-4.1-mini",
    choices: MODELS.map((m) => ({ name: m, value: m }))
  });
}
async function getApiKey() {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;
  const key = await password({
    message: "Enter OpenAI API key (not saved)"
    // mask: "*",
  });
  return String(key ?? "").trim();
}
var program = new Command();
program.name("autoenv").description("Generate .env.example by scanning your project for env usage").version("3.0.3");
program.command("init").description("Scan project and generate .env.example").option("--root <dir>", "Project root to scan", ".").option("--out <file>", "Output file", ".env.example").option("--force", "Overwrite output if it exists").option(
  "--include-lowercase",
  "Include lowercase/mixed-case keys (not recommended)"
).option("--debug", "Print scan diagnostics").action(async (opts) => {
  renderHeader();
  const root = path2.resolve(process.cwd(), opts.root);
  const outFile = path2.resolve(process.cwd(), opts.out);
  if (fs2.existsSync(outFile) && !opts.force) {
    fail(`Output already exists: ${opts.out}`, "Use --force to overwrite.");
  }
  const mode = await pickMode();
  const model = mode === "ai" ? await pickModel() : null;
  const steps = [
    { title: "Preparing", status: "running", detail: `root: ${opts.root}` },
    { title: "Scanning project files", status: "pending" },
    {
      title: "Writing .env.example",
      status: "pending",
      detail: mode === "ai" ? `AI (${model})` : "Default"
    }
  ];
  renderSteps(steps);
  steps[0].status = "done";
  steps[1].status = "running";
  renderSteps(steps);
  const scanSpinner = ora({
    text: "Scanning for env keys",
    spinner: "dots"
  }).start();
  const res = scanProjectForEnvKeys({
    rootDir: root,
    includeLowercase: !!opts.includeLowercase
  });
  scanSpinner.stop();
  steps[1].status = "done";
  steps[1].detail = `${res.filesScanned} files scanned`;
  steps[2].status = "running";
  renderSteps(steps);
  if (opts.debug) {
    console.log(pc.dim(""));
    console.log(pc.dim("Diagnostics"));
    console.log(pc.dim(`  root: ${opts.root}`));
    console.log(pc.dim(`  files scanned: ${res.filesScanned}`));
    console.log(pc.dim(`  keys found: ${res.keys.size}`));
    console.log(pc.dim(""));
  }
  if (res.keys.size === 0) {
    steps[2].status = "fail";
    renderSteps(steps);
    finishSteps();
    fail(
      "No environment variables found.",
      "Ensure your code uses process.env.KEY or ${KEY}."
    );
  }
  const keys = [...res.keys].sort((a, b) => a.localeCompare(b));
  let content = keys.map((k) => `${k}=`).join("\n") + "\n";
  if (mode === "ai" && model) {
    const apiKey = await getApiKey();
    if (!apiKey) {
      steps[2].status = "fail";
      renderSteps(steps);
      finishSteps();
      fail(
        "OpenAI API key is required for AI-assisted mode.",
        "Set OPENAI_API_KEY or enter it when prompted."
      );
    }
    const aiSpinner = ora({
      text: "Generating AI guidance",
      spinner: "dots"
    }).start();
    try {
      const docs = await generateEnvDocsWithOpenAI({
        apiKey,
        model,
        projectHint: "Write practical guidance for developers setting env vars.",
        contexts: res.contexts,
        keys
      });
      aiSpinner.stop();
      const byKey = new Map(docs.map((d) => [d.key, d]));
      content = keys.map((k) => {
        const d = byKey.get(k);
        if (!d) {
          return [
            `# ${k}`,
            `# Description: not provided`,
            `# Where to get it: not provided`,
            `${k}=`,
            ""
          ].join("\n");
        }
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
      aiSpinner.stop();
      steps[2].status = "fail";
      renderSteps(steps);
      finishSteps();
      fail("AI generation failed.", e?.message ?? String(e));
    }
  }
  fs2.writeFileSync(outFile, content, "utf8");
  steps[2].status = "done";
  renderSteps(steps);
  finishSteps();
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [18, 60],
    wordWrap: true
  });
  table.push(
    [pc.dim("Output"), pc.cyan(opts.out)],
    [pc.dim("Keys"), pc.cyan(String(keys.length))],
    [pc.dim("Mode"), pc.cyan(mode === "ai" ? `AI (${model})` : "Default")]
  );
  console.log("");
  console.log(pc.bold("Complete"));
  console.log(table.toString());
  console.log(pc.dim("Next steps"));
  console.log(pc.dim(`  1) Fill values in ${opts.out}`));
  console.log(pc.dim("  2) Copy to .env (do not commit secrets)"));
  console.log("");
});
program.parse(process.argv);
//# sourceMappingURL=autoenv.js.map