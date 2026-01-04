#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import ora from "ora";
import boxen from "boxen";
import logUpdate from "log-update";
import TablePkg from "cli-table3";
import { select, input } from "@inquirer/prompts";
import { fileURLToPath } from "node:url";

import { scanProjectForEnvKeys } from "./scan.js";
import { generateEnvDocsWithOpenAI } from "./ai.js";

// cli-table3 interop safety (works in ESM + CJS environments)
const Table: any = (TablePkg as any).default ?? (TablePkg as any);

type Step = {
  title: string;
  status: "pending" | "running" | "done" | "fail";
  detail?: string;
};

const MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
] as const;

type ModelName = (typeof MODELS)[number];

function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function renderHeader() {
  const body = [
    pc.bold(`Asyq v${getPackageVersion()}`),
    pc.dim("Generate .env.example from your project’s env usage"),
    pc.dim("Created by @thev1ndu"),
  ].join("\n");

  console.log(
    boxen(body, {
      padding: 1,
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
  console.log("");
}

function icon(status: Step["status"]) {
  if (status === "done") return pc.green("✓");
  if (status === "fail") return pc.red("✗");
  if (status === "running") return pc.cyan("•");
  return pc.dim("•");
}

function renderSteps(steps: Step[]) {
  logUpdate(
    steps
      .map((s) => {
        const left = `${icon(s.status)} ${s.title}`;
        const right = s.detail ? pc.dim(s.detail) : "";
        return right ? `${left} ${right}` : left;
      })
      .join("\n")
  );
}

function finishSteps() {
  logUpdate.done();
}

function fail(message: string, hint?: string): never {
  console.error(pc.red(message));
  if (hint) console.error(pc.dim(hint));
  process.exit(1);
}

async function pickMode(): Promise<"default" | "ai"> {
  return await select({
    message: "How would you like to generate .env.example?",
    choices: [
      { name: "Default", value: "default" },
      { name: "AI-assisted", value: "ai" },
    ],
  });
}

async function pickModel(): Promise<ModelName> {
  return await select({
    message: "Select an AI model",
    default: "gpt-4.1-mini",
    choices: MODELS.map((m) => ({ name: m, value: m })),
  });
}

async function getApiKey(): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const key = await input({
    message: "Enter OpenAI API key (not saved)",
    validate: (v) => v.trim().length > 0 || "API key cannot be empty",
  });

  return key.trim();
}

/* ----------------------------- Monorepo support ---------------------------- */

function readWorkspaceGlobs(rootAbs: string): string[] {
  const globs: string[] = [];

  // pnpm-workspace.yaml
  const pnpmWs = path.join(rootAbs, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWs)) {
    const txt = fs.readFileSync(pnpmWs, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
      if (m) globs.push(m[1].trim());
    }
  }

  // package.json workspaces
  const pkgPath = path.join(rootAbs, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const ws = pkg?.workspaces;
      if (Array.isArray(ws)) globs.push(...ws);
      if (ws && Array.isArray(ws.packages)) globs.push(...ws.packages);
    } catch {
      // ignore
    }
  }

  return [...new Set(globs)].filter(Boolean);
}

function expandSimpleGlob(rootAbs: string, pattern: string): string[] {
  // Supports:
  // - apps/*
  // - packages/*
  // - apps/web
  // Ignores advanced globs like **, {}, []
  const norm = pattern.replace(/\\/g, "/").replace(/\/+$/, "");

  if (!norm.includes("*")) {
    const abs = path.join(rootAbs, norm);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? [norm] : [];
  }

  const m = norm.match(/^([^*]+)\/\*$/);
  if (!m) return [];

  const baseRel = m[1].replace(/\/+$/, "");
  const baseAbs = path.join(rootAbs, baseRel);
  if (!fs.existsSync(baseAbs) || !fs.statSync(baseAbs).isDirectory()) return [];

  const out: string[] = [];
  for (const name of fs.readdirSync(baseAbs)) {
    const rel = `${baseRel}/${name}`;
    const abs = path.join(rootAbs, rel);
    if (!fs.statSync(abs).isDirectory()) continue;
    if (fs.existsSync(path.join(abs, "package.json"))) out.push(rel);
  }
  return out;
}

function detectWorkspaces(rootAbs: string): string[] {
  const globs = readWorkspaceGlobs(rootAbs);
  const found = new Set<string>();

  for (const g of globs) {
    for (const rel of expandSimpleGlob(rootAbs, g)) found.add(rel);
  }

  // Turbo-style fallback if no globs detected
  if (found.size === 0) {
    for (const base of ["apps", "packages"]) {
      const baseAbs = path.join(rootAbs, base);
      if (!fs.existsSync(baseAbs) || !fs.statSync(baseAbs).isDirectory())
        continue;
      for (const name of fs.readdirSync(baseAbs)) {
        const rel = `${base}/${name}`;
        const abs = path.join(rootAbs, rel);
        if (!fs.statSync(abs).isDirectory()) continue;
        if (fs.existsSync(path.join(abs, "package.json"))) found.add(rel);
      }
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------------------- */

const program = new Command();

program
  .name("asyq")
  .description("Generate .env.example by scanning your project for env usage")
  .version(`v${getPackageVersion()}`);

program
  .command("init")
  .description("Scan project and generate .env.example")
  .option("--root <dir>", "Project root to scan", ".")
  .option("--out <file>", "Output file name", ".env.example")
  .option("--force", "Overwrite output if it exists")
  .option(
    "--include-lowercase",
    "Include lowercase/mixed-case keys (not recommended)"
  )
  .option("--debug", "Print scan diagnostics")
  .option("--monorepo", "Generate .env.example for root + each workspace")
  .action(async (opts) => {
    renderHeader();

    const rootAbs = path.resolve(process.cwd(), opts.root);
    const outName = String(opts.out || ".env.example");

    const mode = await pickMode();
    const model: ModelName | null = mode === "ai" ? await pickModel() : null;

    const targets: { label: string; dirAbs: string }[] = [
      { label: "root", dirAbs: rootAbs },
    ];

    if (opts.monorepo) {
      const workspaces = detectWorkspaces(rootAbs);
      for (const rel of workspaces) {
        targets.push({ label: rel, dirAbs: path.join(rootAbs, rel) });
      }
    }

    // API key once for all targets (AI mode)
    let apiKey = "";
    if (mode === "ai" && model) {
      apiKey = await getApiKey();
      if (!apiKey) {
        fail(
          "OpenAI API key is required for AI-assisted mode.",
          "Set OPENAI_API_KEY or enter it when prompted."
        );
      }
    }

    const steps: Step[] = [
      {
        title: "Preparing",
        status: "running",
        detail: `targets: ${targets.length}`,
      },
      { title: "Scanning & writing", status: "pending" },
    ];

    renderSteps(steps);

    steps[0].status = "done";
    steps[1].status = "running";
    renderSteps(steps);

    const results: Array<{
      target: string;
      outRel: string;
      keys: number;
      files: number;
    }> = [];

    for (const t of targets) {
      const outFileAbs = path.join(t.dirAbs, outName);
      const outRelFromRoot =
        path.relative(rootAbs, outFileAbs).replace(/\\/g, "/") || outName;

      if (fs.existsSync(outFileAbs) && !opts.force) {
        steps[1].status = "fail";
        renderSteps(steps);
        finishSteps();
        fail(
          `Output already exists: ${outRelFromRoot}`,
          "Use --force to overwrite."
        );
      }

      const scanSpinner = ora({
        text: `Scanning ${t.label}`,
        spinner: "dots",
      }).start();

      const res = scanProjectForEnvKeys({
        rootDir: t.dirAbs,
        includeLowercase: !!opts.includeLowercase,
      });

      scanSpinner.stop();

      if (opts.debug) {
        console.log(pc.dim(`\n${t.label} diagnostics`));
        console.log(pc.dim(`  dir: ${t.dirAbs}`));
        console.log(pc.dim(`  files scanned: ${res.filesScanned}`));
        console.log(pc.dim(`  keys found: ${res.keys.size}\n`));
      }

      if (res.keys.size === 0) {
        // In monorepo mode, don't fail the whole run for empty workspaces.
        results.push({
          target: t.label,
          outRel: outRelFromRoot,
          keys: 0,
          files: res.filesScanned,
        });
        continue;
      }

      const keys = [...res.keys].sort((a, b) => a.localeCompare(b));

      let content = keys.map((k) => `${k}=`).join("\n") + "\n";

      if (mode === "ai" && model) {
        const aiSpinner = ora({
          text: `AI docs ${t.label}`,
          spinner: "dots",
        }).start();

        try {
          const docs = await generateEnvDocsWithOpenAI({
            apiKey,
            model,
            projectHint:
              "Write practical guidance for developers setting env vars.",
            contexts: res.contexts,
            keys,
          });

          aiSpinner.stop();

          const byKey = new Map(docs.map((d) => [d.key, d]));

          content =
            keys
              .map((k) => {
                const d = byKey.get(k);
                if (!d) return `${k}=\n`;

                const secretNote = d.is_secret
                  ? "Secret value. Do not commit."
                  : "Non-secret value (verify before committing).";

                return [
                  `# ${d.key}`,
                  `# ${d.description}`,
                  `# Where to get it: ${d.where_to_get}`,
                  `# ${secretNote}`,
                  `${d.key}=${d.example_value || ""}`,
                  "",
                ].join("\n");
              })
              .join("\n")
              .trimEnd() + "\n";
        } catch (e: any) {
          aiSpinner.stop();
          steps[1].status = "fail";
          renderSteps(steps);
          finishSteps();
          fail(`AI generation failed for ${t.label}.`, e?.message ?? String(e));
        }
      }

      fs.writeFileSync(outFileAbs, content, "utf8");

      results.push({
        target: t.label,
        outRel: outRelFromRoot,
        keys: keys.length,
        files: res.filesScanned,
      });
    }

    steps[1].status = "done";
    renderSteps(steps);
    finishSteps();

    const table = new Table({
      style: { head: [], border: [] },
      colWidths: [28, 10, 60],
      wordWrap: true,
    });

    table.push([pc.dim("Target"), pc.dim("Keys"), pc.dim("Output")]);
    for (const r of results) {
      table.push([
        pc.cyan(r.target),
        pc.cyan(String(r.keys)),
        pc.cyan(r.outRel),
      ]);
    }

    console.log("");
    console.log(pc.bold("Complete"));
    console.log(table.toString());
    console.log("");
  });

program.parse(process.argv);
