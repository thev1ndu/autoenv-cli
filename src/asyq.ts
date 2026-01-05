#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";

import { scanProjectForEnvKeys } from "./scan.js";
import { generateEnvDocsWithOpenAI } from "./ai.js";

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

function fail(message: string): never {
  p.outro(pc.red(message));
  process.exit(1);
}

async function pickMode(): Promise<"default" | "ai"> {
  const mode = await p.select({
    message: "How would you like to generate .env.example?",
    options: [
      { label: "Default (fast)", value: "default" },
      { label: "AI-assisted (adds descriptions)", value: "ai" },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return mode as "default" | "ai";
}

async function pickModel(): Promise<ModelName> {
  const model = await p.select({
    message: "Select an AI model",
    initialValue: "gpt-4.1-mini",
    options: MODELS.map((m) => ({ label: m, value: m })),
  });

  if (p.isCancel(model)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return model as ModelName;
}

async function getApiKey(): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const key = await p.password({
    message: "Enter OpenAI API key (not saved)",
    validate: (v) =>
      v.trim().length > 0 ? undefined : "API key cannot be empty",
  });

  if (p.isCancel(key)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

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

async function pickWorkspaces(workspaces: string[]): Promise<string[]> {
  const picked = await p.multiselect({
    message: "Select workspaces to generate .env.example for",
    options: workspaces.map((w) => ({ label: w, value: w })),
    required: false,
  });

  if (p.isCancel(picked)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return (picked as string[]) ?? [];
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
  .option(
    "--select",
    "In monorepo mode: interactively choose which workspaces to generate for"
  )
  .option(
    "--workspaces <list>",
    "In monorepo mode: comma-separated workspace list to generate for"
  )
  .option("--no-root", "In monorepo mode: skip generating for repo root")
  .action(async (opts) => {
    p.intro(pc.cyan(`\nAsyq CLI v${getPackageVersion()} Created by @thev1ndu`));

    const rootAbs = path.resolve(process.cwd(), opts.root);
    const outName = String(opts.out || ".env.example");

    const mode = await pickMode();
    const model: ModelName | null = mode === "ai" ? await pickModel() : null;

    const targets: { label: string; dirAbs: string }[] = [];

    // Root target (default on, unless --no-root)
    if (opts.root !== false) {
      targets.push({ label: "root", dirAbs: rootAbs });
    }

    // Monorepo targets
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
            String(opts.workspaces)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
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
          targets.push({ label: rel, dirAbs: path.join(rootAbs, rel) });
        }
      }
    }

    if (targets.length === 0) {
      fail(
        "No targets selected. Tip: remove --no-root or select at least one workspace."
      );
    }

    // API key once for all targets (AI mode)
    let apiKey = "";
    if (mode === "ai" && model) {
      apiKey = await getApiKey();
      if (!apiKey) fail("OpenAI API key is required for AI-assisted mode.");
    }

    const results: Array<{
      target: string;
      outRel: string;
      keys: number;
      files: number;
      wrote: boolean;
    }> = [];

    for (const t of targets) {
      const outFileAbs = path.join(t.dirAbs, outName);
      const outRelFromRoot =
        path.relative(rootAbs, outFileAbs).replace(/\\/g, "/") || outName;

      if (fs.existsSync(outFileAbs) && !opts.force) {
        fail(
          `Output already exists: ${outRelFromRoot}. Use --force to overwrite.`
        );
      }

      const s = p.spinner();
      s.start(`Scanning ${t.label} for environment variables`);

      const res = scanProjectForEnvKeys({
        rootDir: t.dirAbs,
        includeLowercase: !!opts.includeLowercase,
      });

      s.stop(
        `Scan complete: ${t.label} (${res.filesScanned} files, ${res.keys.size} keys)`
      );

      if (opts.debug) {
        p.note(
          [
            `dir: ${t.dirAbs}`,
            `files scanned: ${res.filesScanned}`,
            `keys found: ${res.keys.size}`,
          ].join("\n"),
          `${t.label} diagnostics`
        );
      }

      // If no keys, skip writing (current behavior), but show a clear note.
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
          wrote: false,
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
            projectHint:
              "Write practical guidance for developers setting env vars.",
            contexts: res.contexts,
            keys,
          });

          aiSpinner.stop(
            `Documented ${keys.length} env variables for ${t.label}`
          );

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
          aiSpinner.stop(`Failed to write documentation for ${t.label}`);
          fail(e?.message ?? String(e));
        }
      }

      fs.writeFileSync(outFileAbs, content, "utf8");

      results.push({
        target: t.label,
        outRel: outRelFromRoot,
        keys: keys.length,
        files: res.filesScanned,
        wrote: true,
      });
    }

    // Summary table
    const summary = results
      .map((r) => {
        const status = r.wrote ? pc.green("wrote") : pc.yellow("skipped");
        return `${pc.cyan(r.target.padEnd(20))} ${pc.green(
          String(r.keys).padStart(3)
        )} keys → ${pc.dim(r.outRel)} ${pc.dim(`(${status})`)}`;
      })
      .join("\n");

    p.note(summary, "Generated");
    p.outro(pc.green("✓ All done!"));
  });

program.parse(process.argv);
