#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import ora from "ora";
import boxen from "boxen";
import logUpdate from "log-update";
import TablePkg from "cli-table3";
import { select, password } from "@inquirer/prompts";

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

function renderHeader() {
  const body = [
    pc.bold("autoEnv"),
    pc.dim(""),
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

  const key = await password({
    message: "Enter OpenAI API key (not saved)",
    // mask: "*",
  });

  return String(key ?? "").trim();
}

const program = new Command();

program
  .name("autoenv")
  .description("Generate .env.example by scanning your project for env usage")
  .version("3.0.3");

program
  .command("init")
  .description("Scan project and generate .env.example")
  .option("--root <dir>", "Project root to scan", ".")
  .option("--out <file>", "Output file", ".env.example")
  .option("--force", "Overwrite output if it exists")
  .option(
    "--include-lowercase",
    "Include lowercase/mixed-case keys (not recommended)"
  )
  .option("--debug", "Print scan diagnostics")
  .action(async (opts) => {
    renderHeader();

    const root = path.resolve(process.cwd(), opts.root);
    const outFile = path.resolve(process.cwd(), opts.out);

    if (fs.existsSync(outFile) && !opts.force) {
      fail(`Output already exists: ${opts.out}`, "Use --force to overwrite.");
    }

    const mode = await pickMode();
    const model: ModelName | null = mode === "ai" ? await pickModel() : null;

    const steps: Step[] = [
      { title: "Preparing", status: "running", detail: `root: ${opts.root}` },
      { title: "Scanning project files", status: "pending" },
      {
        title: "Writing .env.example",
        status: "pending",
        detail: mode === "ai" ? `AI (${model})` : "Default",
      },
    ];

    renderSteps(steps);

    steps[0].status = "done";
    steps[1].status = "running";
    renderSteps(steps);

    const scanSpinner = ora({
      text: "Scanning for env keys",
      spinner: "dots",
    }).start();

    const res = scanProjectForEnvKeys({
      rootDir: root,
      includeLowercase: !!opts.includeLowercase,
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

    // Default content
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
              if (!d) {
                return [
                  `# ${k}`,
                  `# Description: not provided`,
                  `# Where to get it: not provided`,
                  `${k}=`,
                  "",
                ].join("\n");
              }

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
        steps[2].status = "fail";
        renderSteps(steps);
        finishSteps();
        fail("AI generation failed.", e?.message ?? String(e));
      }
    }

    fs.writeFileSync(outFile, content, "utf8");

    steps[2].status = "done";
    renderSteps(steps);
    finishSteps();

    const table = new Table({
      style: { head: [], border: [] },
      colWidths: [18, 60],
      wordWrap: true,
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
