import fs from "node:fs";
import path from "node:path";

export type ScanOptions = {
  rootDir: string;
  includeLowercase?: boolean; // default false (enterprise-safe)
};

export type ScanResult = {
  keys: Set<string>;
  filesScanned: number;
};

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
]);

/**
 * Default env key style:
 *   DB_URL, REDIS_URL, NEXT_PUBLIC_API_URL, SENTRY_DSN, AWS_REGION
 *
 * You can enable lowercase keys via CLI flag if your project uses them.
 */
const ENV_KEY_RE_STRICT = /^[A-Z][A-Z0-9_]*$/;
const ENV_KEY_RE_LOOSE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function scanProjectForEnvKeys(opts: ScanOptions): ScanResult {
  const root = opts.rootDir;
  const keyOk = (k: string) =>
    (opts.includeLowercase ? ENV_KEY_RE_LOOSE : ENV_KEY_RE_STRICT).test(k);

  // Keep it lightweight: scan common source/config formats (NOT markdown).
  // We do NOT parse KEY= lines from these; only structured env patterns.
  const exts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
  ]);

  const keys = new Set<string>();
  let filesScanned = 0;

  walk(root);
  return { keys, filesScanned };

  function walk(dir: string) {
    let entries: fs.Dirent[];
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
        extractFromEnvFile(content, keys, keyOk);
      } else {
        extractFromCodeAndConfigs(content, keys, keyOk);
      }
    }
  }
}

/**
 * Extract from .env / .env.* files ONLY:
 * Accept lines like:
 *   KEY=value
 *   export KEY=value
 * Ignore:
 *   comments, blank lines
 */
function extractFromEnvFile(
  text: string,
  keys: Set<string>,
  keyOk: (k: string) => boolean
) {
  for (const m of text.matchAll(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
}

/**
 * Extract env keys from code/config formats:
 * - process.env.KEY
 * - process.env["KEY"]
 * - import.meta.env.KEY
 * - Deno.env.get("KEY")
 * - ${KEY}
 *
 * NOTE: We do NOT extract generic KEY= patterns here (avoids JSX/HTML noise).
 */
function extractFromCodeAndConfigs(
  text: string,
  keys: Set<string>,
  keyOk: (k: string) => boolean
) {
  // process.env.KEY / process.env?.KEY
  for (const m of text.matchAll(
    /\bprocess(?:\?\.)?\.env(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)\b/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }

  // process.env["KEY"] / ['KEY']
  for (const m of text.matchAll(
    /\bprocess(?:\?\.)?\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }

  // import.meta.env.KEY
  for (const m of text.matchAll(
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }

  // Deno.env.get("KEY")
  for (const m of text.matchAll(
    /\bDeno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g
  )) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }

  // ${KEY} (docker-compose, yaml, CI)
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const k = m[1];
    if (keyOk(k)) keys.add(k);
  }
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
