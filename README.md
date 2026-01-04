**autoEnv** generates a `.env.example` file by scanning your project for real environment variable usage. It creates a single source of truth for your team without guessing secrets.

## Installation & Usage

First, install it as a development dependency:

```bash
# Using npm
npm install -D @itsthw/autoenv

# Using pnpm
pnpm add -D @itsthw/autoenv

```

Then, run the initialization command:

```bash
npx autoenv init

```

## How It Works

1. **Scan:** Analyzes codebase for `process.env`, `import.meta.env`, and `${VAR}` usage.
2. **Detect:** Identifies only variables that are actually used.
3. **Generate:** Creates a clean `.env.example` file.

- **Default Mode:** Lists variable names only.
- **AI Mode:** Adds descriptions and safe example values using LLMs.

## OpenAI API Key Security

If you choose **AI Mode**, an OpenAI API key is required.

- **Input:** Reads from the `OPENAI_API_KEY` environment variable (recommended) or an interactive prompt.
- **Safety:** The key is **never written to disk**, **never logged**, and **only used for the current run**.

## Key Options

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| `npx autoenv init`         | Standard interactive setup.       |
| `npx autoenv init --force` | Overwrites existing output files. |
