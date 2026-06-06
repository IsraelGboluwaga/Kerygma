# Kerygma — Claude Code Guide

## Package manager

**Always use `yarn`. Never use `npm` or `npx` for package operations.**

```bash
yarn install          # install dependencies
yarn add <pkg>        # add a dependency
yarn add -D <pkg>     # add a dev dependency
yarn remove <pkg>     # remove a dependency
```

The one exception: `npx nodejs-whisper download` is the upstream-prescribed way to compile whisper.cpp and download the model — use it as-is.

---

## Common commands

```bash
yarn dev              # start dev server with tsx watch (hot reload)
yarn build            # compile TypeScript → dist/
yarn start            # run compiled output
yarn test             # run all tests once (vitest)
yarn test:watch       # run tests in watch mode
yarn test:coverage    # run tests with v8 coverage report
yarn typecheck        # type-check without emitting (tsc --noEmit)
```

---

## Project overview

Kerygma is a TypeScript/Node.js church sermon knowledge base.

- **Single process, single port (3000)** — Hono handles chat + admin routes; a raw `http.createServer` wrapper splits `/mcp` to the MCP server
- **Ingestion pipeline** — MP3 → Whisper (transcription) → Claude (semantic chunking) → embeddings → SQLite
- **Chat UI** — members ask questions; FTS5 search retrieves relevant chunks; Claude synthesises an answer streamed via SSE
- **MCP server** — 4 read-only tools for Claude Desktop / any MCP client
- **In-process job queue** — FIFO, persisted to SQLite `jobs` table so history survives restarts

Key source files: `src/main.ts`, `src/config.ts`, `src/web/router.ts`, `src/mcp/server.ts`, `src/ingestion/pipeline.ts`.

Full architecture: `dev-docs/ARCHITECTURE.md`. Chat deep-dive: `dev-docs/CHAT.md`. MCP setup: `mcpConnect.md`.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `ADMIN_SECRET` | Yes | — | Password for the admin UI |
| `MINISTRY_NAME` | No | `the church` | Used in UI titles and AI system prompts |
| `DB_PATH` | No | `./data/sermons.db` | SQLite path |
| `PORT` | No | `3000` | HTTP server port |
| `MAX_AUDIO_DURATION_SECONDS` | No | `7200` | Duration cap for ingested audio |
| `WHISPER_MODEL` | No | `medium.en` | Must match the model compiled into the Docker image |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model for chunking and synthesis |
| `LOG_LEVEL` | No | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` + `ADMIN_SECRET` before running.

---

## Architecture principles

- **No connection pooling** — SQLite via a single `better-sqlite3` singleton (`src/db/connection.ts`); all modules import the same instance.
- **Sequential ingestion** — the job queue runs one job at a time to avoid concurrent Whisper processes.
- **Retry resume** — if chunking fails after transcription, re-ingesting the same URL resumes from the stored transcription (skips download + Whisper).
- **Embeddings stored, not queried** — 384-dim Float32 vectors are stored in `chunks.embedding BLOB` for future vector search. FTS5 is used for all current search.
- **Retry wrapper** — all Anthropic API calls in `src/mcp/server.ts` go through `withRetry()` (`src/retry.ts`); exponential backoff on 429/5xx.
- **Config crash-fast** — `src/config.ts` validates env with Zod on startup and calls `process.exit(1)` on any missing required variable.

---

## Best practices

### Code style
- TypeScript strict mode is on — do not use `any` unless absolutely unavoidable (and add a comment explaining why).
- Prefer explicit return types on exported functions.
- Use `errMsg(err)` from `src/utils.ts` instead of `(err as Error).message` when catching unknown errors.
- Never use `console.log` — use the `logger` singleton from `src/logger.ts`.

### Database
- All DB operations go through typed functions in `src/db/queries.ts` — do not write inline SQL in other modules.
- Use `db.transaction()` for multi-row writes to guarantee atomicity.
- New columns must be accompanied by a migration shim in `src/db/schema.ts` (run `ALTER TABLE ... ADD COLUMN` only when the column is absent).

### Ingestion pipeline
- The pipeline (`src/ingestion/pipeline.ts`) uses a `try/finally` to delete temp files — always preserve this pattern when adding steps.
- `insertPartialSermon` → chunk → `completeSermon` is the retry-safe pattern; do not collapse it into a single write.
- Surface job progress as **structured state, not log lines.** Report sub-steps via the `onPhase` reporter (which the queue maps to the job's `phase` field), and keep per-step `logger` calls at `debug`. This keeps default `info` logs quiet while the status dashboard stays informative.

### Job queue
- The queue (`src/queue.ts`) owns all job state. A job fn receives a `JobContext`; report progress with `ctx.setPhase(...)` rather than mutating job records elsewhere.
- `phase` is meaningful only while `status === 'running'`; the queue clears it on terminal states.

### MCP tools
- MCP tools must remain **read-only** — no writes from `src/mcp/server.ts`.
- All Claude calls inside MCP tools must use `withRetry()`.
- Speaker disambiguation and nearest-date fallback are required for any tool that accepts a speaker or date argument — reuse `resolveSpeaker` and `nearestDateMessage`.

### Testing
- Tests live in `tests/`. Use Vitest.
- Mock external I/O (Anthropic, Whisper, filesystem) — do not make real API calls in tests.
- The test setup file is `tests/setup.ts`; add shared env stubs there.

### Docker
- Layer order matters for cache efficiency: `apt-get` → `yarn install` → model download → `COPY . .` → `yarn build`. Do not reorder.
- Use `--build-arg WHISPER_MODEL=<name>` to switch models at build time.

---

## Keeping documentation up to date

**When you make any change, update the relevant documentation before committing.**

| Type of change | Docs to update |
|---|---|
| New env variable | `README.md` (Configuration table) + `CLAUDE.md` (Environment variables table) + `.env.example` |
| New/changed source file | `dev-docs/ARCHITECTURE.md` (File Responsibilities section) |
| New/changed route or API | `dev-docs/ARCHITECTURE.md` (architecture diagram + data flows) |
| Chat feature changes | `dev-docs/CHAT.md` |
| MCP tool changes | `mcpConnect.md` (Available Tools table) + `README.md` (Available Tools section) |
| New script in `package.json` | `README.md` (Development section) + `CLAUDE.md` (Common commands) |
| Database schema changes | `README.md` (Database Schema) + `dev-docs/ARCHITECTURE.md` (Database Schema) |
| Docker build changes | `README.md` (Layer caching section) + `dev-docs/ARCHITECTURE.md` (Docker Build) |
| New best practice or constraint | `CLAUDE.md` (Best practices) |
