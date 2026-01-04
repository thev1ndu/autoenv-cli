#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { scanProjectForEnvKeys } from "./scan.js";

function header(title: string, subtitle?: string) {
  console.log(pc.bold(title));
  if (subtitle) console.log(pc.dim(subtitle));
  console.log("");
}

function line(label: string, value: string) {
  console.log(`  ${pc.dim(label)} ${value}`);
}

const program = new Command();

program
  .name("envguard")
  .description(
    "Generate a .env.example file by scanning your project for env usage"
  )
  .version("1.0.1");

program
  .command("init")
  .description("Scan project and generate .env.example with KEY= lines")
  .option("--root <dir>", "Project root to scan", ".")
  .option("--out <file>", "Output file", ".env.example")
  .option("--force", "Overwrite output if it exists")
  .option(
    "--include-lowercase",
    "Also include lowercase/mixed-case keys (not recommended)"
  )
  .option("--debug", "Print scan diagnostics")
  .action((opts) => {
    header("envguard", "Initializing environment template");

    const root = path.resolve(process.cwd(), opts.root);
    const outFile = path.resolve(process.cwd(), opts.out);

    if (fs.existsSync(outFile) && !opts.force) {
      console.error(pc.red(`Output already exists: ${opts.out}`));
      console.error(pc.dim("Use --force to overwrite."));
      process.exit(1);
    }

    const res = scanProjectForEnvKeys({
      rootDir: root,
      includeLowercase: !!opts.includeLowercase,
    });

    if (opts.debug) {
      line("root:", opts.root);
      line("files scanned:", String(res.filesScanned));
      line("keys found:", String(res.keys.size));
      console.log("");
    }

    if (res.keys.size === 0) {
      console.error(pc.red("No env keys found."));
      console.error(
        pc.dim(
          "Make sure your code uses process.env.KEY or configs use ${KEY}."
        )
      );
      console.error(
        pc.dim("If this is a monorepo, try --root apps or --root packages.")
      );
      process.exit(1);
    }

    const sorted = [...res.keys].sort((a, b) => a.localeCompare(b));
    const content = sorted.map((k) => `${k}=`).join("\n") + "\n";

    fs.writeFileSync(outFile, content, "utf8");

    console.log(pc.green("Success"));
    line("created:", opts.out);
    line("keys:", String(sorted.length));
    console.log("");
    console.log(pc.dim("Next steps"));
    console.log(pc.dim(`  1) Fill values in ${opts.out}`));
    console.log(pc.dim("  2) Copy to .env (do not commit secrets)"));
  });

program.parse(process.argv);
