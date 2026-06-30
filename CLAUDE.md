# Kerygma — Claude Code Guide

## Package manager

**Always use `yarn`. Never use `npm` or `npx` for package operations.**

```bash
yarn install          # install dependencies
yarn add <pkg>        # add a dependency
yarn add -D <pkg>     # add a dev dependency
yarn remove <pkg>     # remove a dependency
```

---

## Common commands

```bash
yarn dev              # backend (tsx watch) + Vite dev server together — open http://localhost:5173
yarn dev:server       # backend only (tsx watch src/main.ts)
yarn dev:web          # Vite dev server only (:5173, proxies /api → :3000)
yarn build            # build the React SPA (→ public/app) and the backend (→ dist)
yarn build:web        # Vite build only
yarn build:server     # esbuild backend only
yarn start            # run compiled output
yarn test             # run all tests once (vitest)
yarn test:watch       # run tests in watch mode
yarn test:coverage    # run tests with v8 coverage report
yarn typecheck        # type-check the backend (tsc --noEmit)
yarn typecheck:web    # type-check the frontend (tsc --noEmit)
```

The frontend lives in `frontend/` as a yarn **workspace** — a single `yarn install` at the repo root installs both backend and frontend deps.

---

## Project overview

Kerygma is a TypeScript/Node.js church sermon knowledge base.

- **Single process, single port (3000)** — Hono serves `/api/*` JSON+SSE and the built React SPA; a raw `http.createServer` wrapper splits `/mcp` to the MCP server
- **React + Vite frontend** — a TypeScript/Tailwind SPA in `frontend/` (chat, transcripts, admin, live status, DB browser); built to `public/app` and served by Hono
- **Ingestion pipeline** — MP3 → Whisper (transcription) → Claude (semantic chunking) → embeddings → SQLite
- **Chat UI** — members ask questions; FTS5 search retrieves relevant chunks; Claude synthesises an answer streamed via SSE
- **MCP server** — 4 read-only tools for Claude Desktop / any MCP client
- **In-process job queue** — FIFO, persisted to SQLite `jobs` table so history survives restarts

Key source files: `src/main.ts`, `src/config.ts`, `src/web/router.ts`, `src/mcp/server.ts`, `src/ingestion/pipeline.ts`, `frontend/src/App.tsx`, `frontend/src/api/client.ts`.

Full architecture: `dev-docs/ARCHITECTURE.md`. Chat deep-dive: `dev-docs/CHAT.md`. MCP setup: `mcpConnect.md`.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key (used for Whisper transcription) |
| `ADMIN_SECRET` | Yes | — | Password for the admin UI |
| `SERMON_BASE_URL` | Yes | — | Full sermon listing endpoint; the `page`/`perPage` query string is appended directly (e.g. `https://sermons-api.example.com/sermons`) |
| `AUDIO_BASE_URL` | Yes | — | Base URL prepended to relative audio paths from the sermon API (e.g. `https://cdn.example.com`); a trailing slash is normalised |
| `MINISTRY_NAME` | No | `the church` | Used in UI titles and AI system prompts |
| `DB_PATH` | No | `./data/sermons.db` | SQLite path |
| `PORT` | No | `3000` | HTTP server port |
| `MAX_AUDIO_DURATION_SECONDS` | No | `7200` | Duration cap for ingested audio |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model for chat synthesis |
| `CHUNKING_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model for semantic chunking |
| `BOOK_MODEL` | No | `CLAUDE_MODEL` | Claude model for drafting book chapters (falls back to `CLAUDE_MODEL`) |
| `LOG_LEVEL` | No | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |
| `R2_ACCOUNT_ID` | No | — | Cloudflare account ID; required for Litestream R2 replication |
| `R2_ACCESS_KEY_ID` | No | — | R2 access key ID; required for Litestream R2 replication |
| `R2_SECRET_ACCESS_KEY` | No | — | R2 secret access key; required for Litestream R2 replication |
| `R2_BUCKET` | No | — | R2 bucket name; replication is skipped entirely if any R2 var is unset |

Copy `.env.example` to `.env` and fill in the required variables before running.

---

## Architecture principles

- **No connection pooling** — SQLite via a single `better-sqlite3` singleton (`src/db/connection.ts`); all modules import the same instance.
- **Sequential ingestion** — the job queue runs one job at a time to prevent concurrent downloads and API calls.
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
- `insertPartialSermon` → `insertTranscription` → chunk → `completeSermon` is the retry-safe pattern; do not collapse it into a single write.
- Transcripts are stored in the `transcriptions` table (one-to-one with `sermons` via `sermon_id` FK) to keep `sermons` queries fast.
- Resume logic checks `transcriptions` table first, falls back to `sermons.transcription` for backward compat with older rows.
- Surface job progress as **structured state, not log lines.** Report sub-steps via the `onPhase` reporter (which the queue maps to the job's `phase` field), and keep per-step `logger` calls at `debug`. This keeps default `info` logs quiet while the status dashboard stays informative.

### Job queue
- The queue (`src/queue.ts`) owns all job state. A job fn receives a `JobContext`; report progress with `ctx.setPhase(...)` rather than mutating job records elsewhere.
- `phase` is meaningful only while `status === 'running'`; the queue clears it on terminal states.

### MCP tools
- MCP tools must remain **read-only** — no writes from `src/mcp/server.ts`.
- All Claude calls inside MCP tools must use `withRetry()`.
- Speaker disambiguation and nearest-date fallback are required for any tool that accepts a speaker or date argument — reuse `resolveSpeaker` and `nearestDateMessage`.
- Register tools through the loosely-typed `tool` boundary (`server.tool.bind(server) as unknown as RegisterTool`) in `createMcpServer`, not `server.tool` directly. The SDK's generic overload forces `tsc` to instantiate `ShapeOutput<Args>` over both bundled Zod v3/v4 type machineries, which exploded `yarn typecheck` to ~18M instantiations (~3.5 min). The boundary skips that inference; each handler keeps its own explicit `{ ... }` arg type and `Promise<CallToolResult>` return type. Do **not** reintroduce `@ts-expect-error` suppressions — they hide the error but `tsc` still does all the work.

### Frontend (React + Vite)
- The UI is a React SPA in `frontend/` (a yarn **workspace**), built by Vite to `public/app` and served by Hono's catch-all. The backend renders **no HTML** — it exposes JSON/SSE under `/api/*` plus the PDF download. Do not reintroduce server-rendered `*Html.ts` page modules.
- **All data lives under `/api/*`.** When you add a backend endpoint the SPA consumes, prefix it `/api/` so it never collides with a client-side route caught by the SPA fallback. Keep `/transcripts/:id/download` (PDF) as the one non-`/api` data route, since the SPA links to it directly.
- Keep the data-fetching in `frontend/src/api/client.ts` (typed wrappers + `streamChat` SSE reader) and its response shapes in `frontend/src/api/types.ts` **in sync with `src/web/router.ts`**. These are two hand-maintained copies of the same contract.
- Styling is **Tailwind**, mobile-responsive, using the tokens in `frontend/tailwind.config.ts` (dark theme, `accent` red). Reuse `.btn-primary`/`.btn-ghost`/`.card`/`.field`/`.badge` component classes from `index.css` rather than re-deriving the look.
- The admin secret stays in `sessionStorage` via `useAdminSecret` and is sent as `X-Admin-Secret` — never persist it elsewhere or send it in a URL.
- Vite emits content-hashed assets under `/static`; the logo/icon files served from `public/assets` stay at `/assets`. Don't let Vite output collide with `/assets`.
- The app is an installable **PWA** (`vite-plugin-pwa`, generated `sw.js` + `manifest.webmanifest`). The service worker precaches the app shell and runtime-caches only **public read-only** data (`/api/transcripts/*`, `/api/themes`, `/assets/*`). **Never add caching for `/api/chat` (live SSE) or any `/api/admin/*` / `/api/db/*` route** — they are live and/or secret-gated. Keep those out of `runtimeCaching` and in `navigateFallbackDenylist`. PWA icons live in `public/assets/` (`pwa-192x192`, `pwa-512x512`, maskable); regenerate them from `favicon.svg` with `sharp` if the mark changes.

### Chat
- The chat (`POST /api/chat` in `src/web/router.ts`) is **agentic**: Claude is given read-only tools (`CHAT_TOOLS`, dispatched by `runChatTool`) and chooses the lookup. Do **not** revert to a single pre-baked `searchChunks` call stuffed into the prompt — that under-serves enumeration questions.
- **Enumeration must use `list_sermons`, not excerpt search.** A top-N relevance search (`searchChunks`) returns a *sample* and silently drops sermons, so "what sermons were preached that month?" came back incomplete. `list_sermons` returns the **complete** roster for a date/topic/speaker filter via `resolveTranscriptSermons`. Keep the system-prompt instruction that forbids "these are only the excerpts I was given" disclaimers when answering from `list_sermons`.
- Keep the single `cache_control` breakpoint on the chat system prompt: the tools+system prefix is byte-identical across the loop's calls, so it reads at ~0.1× input cost. Don't interpolate per-request values into that system prompt (it would break the cache).
- The agentic loop is capped (`step < 6`). Keep a cap — an uncapped tool loop can run away.
- Sources stream as `context` events *after* tools run (not before the answer), so the frontend `Sources` rendering must remain able to attach/refresh the `<details>` on an existing bubble.

### Book generation
- A book draft is generated by `generateBook` (`src/book/generator.ts`) as a background **job** (reuse `enqueue` + `ctx.setPhase`; book phases `retrieving → outlining → drafting → rendering` live in `JobPhase`). Do not run generation inline in the request handler.
- The corpus is the **complete topic roster** (`searchSermonsByTopic` → `getSermonsByThemeName` → `findSermonsByTitle`), grounded in real chunk text. Keep books a **faithful synthesis of the ministry's own sermons with citations** — never general knowledge. The chapter system prompt must keep that constraint.
- All Anthropic calls go through `withRetry`. The outline is a forced `emit_outline` tool call (parsed `input`, never `JSON.parse` of free text), mirroring the chunker.
- Persist Markdown (chapters) in SQLite, not a PDF on disk: SQLite is what Litestream replicates; the container is ephemeral. The PDF is rendered **on demand** by `src/web/bookPdf.ts` (pdfkit — no headless browser, same rule as transcripts) at `GET /books/:id/download`, gated on `book.status === 'done'`.
- The drafting model is `config.BOOK_MODEL ?? config.CLAUDE_MODEL` — resolved at the use site, not baked into the Zod schema.

### Transcripts page
- Transcript text comes from the `transcriptions` table (`getTranscriptionBySermonId`) — the verbatim copy. Do not rebuild it from chunks.
- PDFs are generated on demand with `pdfkit` (pure JS) in `src/web/transcriptPdf.ts`. Do **not** swap in a headless-browser renderer (Puppeteer/Playwright) — it would add a browser process and hundreds of MB of RAM to this single-process app.
- `/api/transcripts/search` must be registered before `/api/transcripts/:videoId` so the static path isn't captured as a video id.
- The natural-language query parser (`parseTranscriptQuery`) uses `CHUNKING_MODEL` via `withRetry` and must degrade to `{}` (then a keyword fallback) rather than erroring.
- A subject like "on faith" is a **topic** (relevance), not a formal **theme**. `searchSermonsByTopic` matches the term only in the Claude-derived `topics`/`summary` FTS columns and ranks by density (share of sections about it) — do not resolve a topic with a bare content keyword match, which for common words like "faith" matches nearly every sermon.

### Testing
- Tests live in `tests/`. Use Vitest.
- Mock external I/O (Anthropic, Whisper, filesystem) — do not make real API calls in tests.
- The test setup file is `tests/setup.ts`; add shared env stubs there.

### Docker
- Layer order matters for cache efficiency: `apt-get` → `yarn install` → `COPY . .` → `yarn build`. Do not reorder.
- Transcription uses the OpenAI Whisper API (`whisper-1`), not a local model — there is no model to download or compile at build time. `ffmpeg` is bundled only to compress audio over 25 MB before upload.

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
