# Asyq CLI — Environment Variable Scanner & .env Generator with AI

Automatically generate `.env.example` files by scanning your codebase for environment variable usage.

<div align="center">

[![asyqcli.gif](https://i.postimg.cc/jqJYDbFd/asyqcli.gif)](https://postimg.cc/bd8B5KPK)

</div>

<p>
  <b>Stop letting your environment templates fall out of sync.</b><br>
  Asyq scans your source code to detect variable usage and automatically generates a complete <code>.env.example</code> file—ensuring your team never struggles with missing configuration keys again.
</p>

## Installation

```bash
npm install -D asyq
# or
pnpm add -D asyq
# or
yarn add -D asyq
```

## Usage

```bash
npx asyq init
```

Choose between two modes:

- **Default** - Fast generation with variable names only
- **AI-assisted** - Adds descriptions and example values (requires OpenAI API key)

## Commands

| Command                    | Description                 |
| -------------------------- | --------------------------- |
| `npx asyq init`            | Interactive setup           |
| `npx asyq init --force`    | Overwrite existing files    |
| `npx asyq init --monorepo` | Generate for each workspace |
| `npx asyq init --debug`    | Show scan diagnostics       |

## Options

| Option                | Description                               |
| --------------------- | ----------------------------------------- |
| `--root <dir>`        | Project root to scan (default: `.`)       |
| `--out <file>`        | Output filename (default: `.env.example`) |
| `--force`             | Overwrite without confirmation            |
| `--include-lowercase` | Include mixed-case variables              |
| `--debug`             | Print detailed diagnostics                |
| `--monorepo`          | Generate for root + workspaces            |

## Examples

```bash
# Basic usage
npx asyq init

# Force overwrite
npx asyq init --force

# Monorepo project
npx asyq init --monorepo

# Custom output
npx asyq init --out .env.template

# Scan specific directory
npx asyq init --root ./packages/api
```

Set your OpenAI API key:

```bash
export OPENAI_API_KEY=sk-...
npx asyq init
```

Or enter it when prompted (not saved to disk).
