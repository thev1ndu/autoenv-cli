import fs from "node:fs";
import path from "node:path";

export type ScanOptions = {
  rootDir: string;
  includeLowercase?: boolean; // default false
  maxContextPerKey?: number; // default 2
};

export type KeyContext = { file: string; line: number; snippet: string };

export type ScanResult = {
  keys: Set<string>;
  filesScanned: number;
  contexts: Record<string, KeyContext[]>;
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

// Enterprise-safe default: UPPERCASE env keys only
const ENV_KEY_RE_STRICT = /^[A-Z][A-Z0-9_]*$/;
const ENV_KEY_RE_LOOSE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function scanProjectForEnvKeys(opts: ScanOptions): ScanResult {
  const root = opts.rootDir;
  const maxCtx = opts.maxContextPerKey ?? 2;

  const keyOk = (k: string) =>
    (opts.includeLowercase ? ENV_KEY_RE_LOOSE : ENV_KEY_RE_STRICT).test(k);

  // Scan common source/config formats (avoid HTML/MD noise)
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
  const contexts: Record<string, KeyContext[]> = {};
  let filesScanned = 0;

  walk(root);

  return { keys, filesScanned, contexts };

  function addCtx(key: string, file: string, line: number, snippet: string) {
    if (!contexts[key]) contexts[key] = [];
    if (contexts[key].length >= maxCtx) return;
    contexts[key].push({
      file,
      line,
      snippet: snippet.trim().slice(0, 220),
    });
  }

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
        extractFromEnvFile(content, entry.name, keys, addCtx, keyOk);
      } else {
        extractFromCodeAndConfigs(content, entry.name, keys, addCtx, keyOk);
      }
    }
  }
}

function extractFromEnvFile(
  text: string,
  fileName: string,
  keys: Set<string>,
  addCtx: (key: string, file: string, line: number, snippet: string) => void,
  keyOk: (k: string) => boolean
) {
  // KEY=... or export KEY=...
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

function extractFromCodeAndConfigs(
  text: string,
  fileName: string,
  keys: Set<string>,
  addCtx: (key: string, file: string, line: number, snippet: string) => void,
  keyOk: (k: string) => boolean
) {
  const lines = text.split(/\r?\n/);

  // Only structured env patterns here (NO generic KEY= parsing)
  const patterns: RegExp[] = [
    /\bprocess(?:\?\.)?\.env(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\bprocess(?:\?\.)?\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\bDeno\.env\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g,
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    for (const re of patterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(ln))) {
        const k = match[1];
        if (!keyOk(k)) continue;
        keys.add(k);
        addCtx(k, fileName, i + 1, ln);
      }
    }
  }
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
