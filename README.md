# autoEnv v

Generate a `.env.example` file by scanning your project for real environment variable usage.

**autoEnv** analyzes your codebase to detect environment variables and can optionally use AI to generate human-readable documentation and safe example values.

Created by **@thev1ndu**

---

## Why autoEnv?

Managing environment variables manually is error-prone and inconsistent across teams. autoEnv solves this by:

- detecting **only variables that are actually used**
- generating a **single source of truth** (`.env.example`)
- optionally adding **clear guidance for developers**

---

## Features

- Accurate detection from real code usage
- Optional AI-generated documentation
- Monorepo-aware (pnpm / yarn / npm workspaces)
- Never creates `.env`
- Never guesses secrets
- No runtime dependencies
- Modern ESM-first CLI
- Designed for teams and CI workflows

---

## Installation

### Use with npx (recommended)

No installation required:

```bash
npx autoenv init
```

---

### Install as a dev dependency

Using **pnpm**:

```bash
pnpm add -D @itsthw/autoenv
```

Using **npm**:

```bash
npm install -D @itsthw/autoenv
```

Then run:

```bash
npx autoenv init
```

---

## Basic Usage

```bash
npx autoenv init
```

You will be guided through an interactive setup.

---

## Generation Modes

### Default mode

Scans the project, generates `.env.example`, and outputs only variable names.

Example:

```env
DATABASE_URL=
JWT_SECRET=
NODE_ENV=
```

---

### AI-assisted mode

Adds structured comments and safe example values:

```env
# DATABASE_URL
# PostgreSQL connection string used by the application
# Where to get it: Local database or cloud provider
# Secret value. Do not commit.
DATABASE_URL=postgresql://user:password@localhost:5432/app

# NODE_ENV
# Runtime environment
# Where to get it: Set manually
NODE_ENV=development
```

AI mode:

- never generates real secrets
- never stores your API key
- uses only detected variables

---

## AI Model Selection

When AI mode is selected, you can choose from supported models:

```
gpt-4.1-mini (default)
gpt-4.1
gpt-5
gpt-5-mini
gpt-5-nano
gpt-4.1-nano
```

The default model balances quality and cost for documentation generation.

---

## OpenAI API Key

autoEnv reads the key from:

1. `OPENAI_API_KEY` environment variable (recommended)
2. Interactive prompt (not saved)

Example:

```bash
export OPENAI_API_KEY=sk-xxxx
```

The key is:

- never written to disk
- never logged
- only used for the current run

---

## Monorepo Support

autoEnv automatically detects monorepos using:

- `pnpm-workspace.yaml`
- `workspaces` field in `package.json`

When detected, you can:

- scan the entire repository
- select specific workspaces (e.g. `apps/web`, `packages/api`)

### Manual control

Force monorepo mode:

```bash
npx autoenv init --monorepo
```

Limit scanning scope:

```bash
npx autoenv init --scope apps/web,packages/api
```

---

## CLI Options

```bash
autoenv init [options]
```

| Option                | Description                           |
| --------------------- | ------------------------------------- |
| `--root <path>`       | Root directory to scan (default: `.`) |
| `--out <file>`        | Output file (default: `.env.example`) |
| `--force`             | Overwrite output file                 |
| `--include-lowercase` | Include lowercase/mixed-case keys     |
| `--monorepo`          | Force monorepo flow                   |
| `--scope <paths>`     | Comma-separated scan paths            |
| `--debug`             | Print scan diagnostics                |

---

## What autoEnv Detects

- `process.env.MY_VAR`
- `process.env["MY_VAR"]`
- `import.meta.env.MY_VAR`
- `Deno.env.get("MY_VAR")`
- `${MY_VAR}` in configs
- existing `.env` / `.env.*` files

By default, only **UPPERCASE** variables are included.

---

## What autoEnv Will NOT Do

- Create `.env`
- Guess secret values
- Modify your source code
- Upload your project
- Persist API keys

---

## Recommended Workflow

1. Run `autoenv`
2. Review `.env.example`
3. Fill values locally
4. Copy to `.env`
5. Commit `.env.example`
6. Keep `.env` ignored

---

## License

MIT

---

## Author

Created and maintained by **@thev1ndu**
