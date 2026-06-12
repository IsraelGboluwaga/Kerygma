# Kerygma — Architecture

## Overview

One Node.js process. One port (3000). Three jobs:
1. **React SPA (Vite)** — chat + transcripts for members, password-gated admin/status/DB pages; the backend serves the built bundle and exposes JSON/SSE under `/api/*`
2. **Ingestion** — a church admin ingests MP3 sermons via the password-gated admin UI
3. **MCP Server** — lets Claude Desktop (or any MCP client) query sermons programmatically

```
Browser (React SPA — public/app, client-side routing)
    │  GET  /, /transcripts, /admin, /admin/live, /lyrical-theology → SPA shell (index.html)
    │  POST /api/chat              → SSE stream (Claude answer)
    │  GET  /api/transcripts/search, /api/transcripts/:id, /api/themes
    │  GET  /api/admin/status, /api/admin/jobs, /api/admin/status/data  (X-Admin-Secret)
    │  POST /api/admin/sync-api    → Trigger background API sync → 202   (X-Admin-Secret)
    │  GET  /api/db/:table         → Paginated table rows               (X-Admin-Secret)
    │  GET  /transcripts/:id/download → on-demand PDF
    ▼
Hono HTTP Server (:3000)
    ├── GET /health        → { ok: true }
    └── GET * (catch-all)  → serves public/app static files, falls back to index.html
         │
    In-process job queue (FIFO, sequential — one job at a time)
         │
    Ingestion Pipeline
         ├── 1. Download MP3 → temp file
         ├── 2. OpenAI Whisper API → TranscriptSegment[] + plain-text transcript
         ├── 3. Claude → semantic chunks (section_name, timestamps, topics, summary)
         ├── 4. @xenova/transformers → 384-dim embedding per chunk
         └── 5. better-sqlite3 → write sermons + transcriptions + chunks to SQLite

Raw Node HTTP server (main.ts)
    ├── /mcp  → StreamableHTTPServerTransport → McpServer (4 read-only tools)
    └── all other routes → Hono (via getRequestListener)

MCP Client (Claude Desktop / any MCP-compatible app)
    │  HTTP POST /mcp
    ▼
McpServer (4 read-only tools)
    └── better-sqlite3 reads (FTS5 search + Claude synthesis)
```

---

## File Responsibilities

### `src/config.ts`
Validates `process.env` with Zod on startup. If a required variable is missing, the
process crashes with a clear error before doing anything else. Exports a frozen singleton.

Key required variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ADMIN_SECRET`, `SERMON_BASE_URL`, `AUDIO_BASE_URL`. Optional: `MINISTRY_NAME`, `CHUNKING_MODEL`, `CLAUDE_MODEL`, `MAX_AUDIO_DURATION_SECONDS`, `DB_PATH`, `PORT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

### `src/logger.ts`
Winston-based logger exported as a singleton `logger`. Uses colourised output in
development (`NODE_ENV !== 'production'`) and plain timestamped lines in production.
Log level defaults to `'info'`; override with `LOG_LEVEL` env var. Used throughout
the codebase for structured runtime logging.

### `src/retry.ts`
`withRetry(fn, { attempts?, baseDelayMs? })` — wraps any async function with
exponential-backoff retry logic. Only retries on Anthropic-specific transient
HTTP status codes: `429` (rate limit), `500`, `502`, `503`, `529` (overloaded).
Default: 3 attempts, starting at 1 s delay (1 s → 2 s → 4 s). Used by all
Anthropic API calls in `src/mcp/server.ts`.

### `src/utils.ts`
Small shared utilities. Currently exports `errMsg(err)` — safely extracts a string from
any thrown value (`err.message` for `Error` instances, `String(err)` otherwise).

### `src/backup/r2Archive.ts`
Creates human-readable SQLite archive exports in Cloudflare R2 when all four R2 env vars
are configured. Uses `better-sqlite3`'s online backup API to create a consistent temp
database file, then uploads it with an S3-compatible signed `PUT` to
`archives/sermons-<timestamp>.db`. Runs once on startup and then daily at 03:15 UTC.

### `src/db/schema.ts`
Defines the SQLite DDL:
- `sermons` table — one row per ingested MP3
- `chunks` table — many rows per sermon (each chunk = one section of the sermon)
- `chunks_fts` — virtual FTS5 table for full-text search (auto-synced via triggers)
- `jobs` table — persisted job queue state for history and cross-restart visibility
- Migration shims — `ALTER TABLE` statements run only when a column is absent, so an
  existing DB keeps working after adding new columns

### `src/db/connection.ts`
Creates a single `better-sqlite3` instance and runs `initDatabase()` once at startup.
All other modules import this singleton — no connection pooling needed for SQLite.

### `src/db/queries.ts`
Typed functions for every DB operation:
- `saveSermon(data)` → `number` (sermon id)
- `saveChunks(sermonId, chunks[])` — uses `db.transaction()` for atomicity
- `insertPartialSermon(data)` → `number` — saves a partially-ingested sermon with `ingestion_status='transcribed'`
- `insertTranscription(sermonId, transcript, segments)` — stores plain-text + JSON segments in the `transcriptions` table
- `getTranscriptionBySermonId(id)` → `TranscriptionRow | null`
- `completeSermon(id)` — sets `ingestion_status='done'`
- `getSermonByVideoId(id)` → `SermonRow | null`
- `getSermonsByDate(date)` → `SermonRow[]`
- `getNearestSermonByDate(date)` → `SermonRow | null` — closest sermon when exact date has no results
- `getSpeakersMatchingFilter(filter)` → `string[]` — distinct speaker names matching substring
- `getChunksBySermonId(id)` → `ChunkRow[]`
- `searchChunks(query, limit)` → `ChunkWithSermon[]` — FTS5 search with stopword filtering and OR semantics; meaningful keywords are matched against any chunk, ranked by relevance
- `listSermons(limit)` → `SermonRow[]`
- `upsertTheme(theme)` → `number` — inserts/updates a theme keyed on its upstream id, returns the local `themes.id`
- `getSermonsByTheme(themeId)` → `SermonRow[]` — all sermons for an upstream theme id, newest first
- `listThemes()` → `ThemeRow[]`
- `upsertJob` / `getJobRow` / `listRecentJobRows` / `failStaleJobs` — job persistence

### `src/ingestion/downloader.ts`
Streams an MP3 URL to a temp file using native `fetch`.
Returns `{ filePath, cleanup }` — caller always calls `cleanup()` in a `finally` block.
Uses `AbortSignal.timeout(5 * 60 * 1000)` to cap download time.

### `src/ingestion/transcriber.ts`
Calls the OpenAI Whisper API (`whisper-1` model, `response_format: 'verbose_json'`).
The `verbose_json` format returns both the full plain-text transcript and per-segment timestamps.
Lazy-initialises a singleton `OpenAI` client (one per process).
Returns `{ segments: TranscriptSegment[], duration: number, transcript: string }`.

### `src/ingestion/api-source.ts`
Paginates through the sermon listing endpoint at `SERMON_BASE_URL` (50 per page) —
`SERMON_BASE_URL` is the full listing URL (e.g. `https://host/sermons`) and the
`page`/`perPage` query string is appended directly.
Maps each API sermon `{ _id, title, preacher, sermon_date, audio_info, theme, tags, excerpt, description_string }`
to an `IngestRequest`. Audio URLs that are relative paths are joined onto `AUDIO_BASE_URL`
(slash-tolerant, so a trailing slash on the base does not produce a doubled `//`).
The API `theme` (`{ _id, name, slug }`) is carried through only when it has both an `_id` and a `name`.
Exported as an async generator: `fetchAllSermons(): AsyncGenerator<IngestRequest>`.

### `src/ingestion/chunker.ts`
- Formats transcript as `[MM:SS] text` lines
- Sends to Claude with a semantic chunking prompt
- Validates the response is a text block (throws on unexpected content type)
- Parses JSON response
- Runs `validateChunks` (sort → fill gaps/overlaps in one pass)
- Attaches content text to each chunk
- Exports `formatTimestamp` (used by router and MCP tools)

### `src/ingestion/embedder.ts`
Loads `Xenova/all-MiniLM-L6-v2` once at startup (~90MB download on first run).
`generateEmbedding(text)` returns a `Buffer` of raw Float32 bytes (384 floats = 1536 bytes).
Stored in `chunks.embedding BLOB` for future vector search — not queried yet.

### `src/ingestion/pipeline.ts`
Orchestrates the full ingestion flow for one sermon:
```
videoId = req.videoId ?? SHA256(downloadUrl)[:16]
check existing record
  → if ingestion_status='transcribed': resume from transcriptions table (skip download)
  → if ingestion_status='done': return duplicate
  → else: download → transcribe → insertPartialSermon → insertTranscription
            → chunk → embed each chunk → completeSermon (sets status='done')
            → cleanup temp file
```
`try/finally` guarantees the temp file is always deleted.
The partial-record step means a retry after a chunking failure skips re-download and re-transcription.
Returns `{ status: 'ok' | 'duplicate' | 'too_long' | 'error', message, sermonId? }`.

Input:
```ts
{ videoId?, downloadUrl, webpageUrl?, title, speaker, date, excerpt?, theme?, tags?, description? }
```
`theme` is `{ themeId, name, slug? }`; on insert it is upserted into the `themes` table (keyed on the
upstream `themeId`) and the sermon stores the resulting `themes.id` as `theme_id`. Speaker is required.

### `src/scheduler.ts`
On startup, calls `syncFromApi()` immediately so a fresh deploy doesn't wait up to 10 hours for
the first batch. Then registers a `node-cron` job: every 10 hours for the first 4 days, then
daily at 06:00 (`'0 6 * * *'`) for ongoing syncs. The phase switch is handled via a
`setTimeout` that stops the frequent task and starts the daily one.

`syncFromApi` enqueues every sermon from the API except those already fully ingested
(`ingestion_status === 'done'`). Partial rows (status `transcribed` — e.g. a prior chunking
failure) are re-enqueued so they resume from the stored transcript via `ingestSermon`'s resume
path, instead of being skipped forever. This is what lets a failed chunking auto-heal on the next
sync rather than needing a manual re-ingest.
Calls `fetchAllSermons()` and enqueues any sermon whose `videoId` doesn't exist in the DB yet.
Stops enqueueing if `getQueueDepth() >= 500` to avoid runaway growth.
Also exports `syncFromApi(anthropic)` for use by the manual `POST /admin/sync-api` endpoint.

### `src/queue.ts`
In-process FIFO queue. Jobs are held in a `Map<string, Job>` (in-memory) and persisted to
the `jobs` DB table so history survives server restarts.
- `enqueue(fn, meta)` → UUID — pushes a job with title, downloadUrl, and payload (JSON of the original request for retries), triggers `drain()` if nothing is running
- `drain()` — pops jobs one at a time; passes each fn a `JobContext` whose `setPhase(phase)` updates and persists the running job's `phase` (cleared on terminal states); a failed job logs the error and moves on to the next
- `getJob(id)` — checks in-memory first, falls back to DB for jobs from previous runs
- `getRecentJobs(n)` — reads from DB, overlays in-memory state for active jobs
- `getQueuePosition(id)` — 1-based position of a job still waiting in line, else null
- `waitUntilIdle()` — used during graceful shutdown

Job phases (`downloading` → `transcribing` → `chunking` → `embedding`) are reported by the ingestion pipeline through the `setPhase` callback, giving the status dashboard live sub-step visibility without adding log volume.

### `src/mcp/server.ts`
`createMcpServer(anthropic)` — accepts an injected Anthropic client.
Registers 4 tools:
1. `list_sermons(limit)` — list indexed sermons
2. `ask_church(question, date_filter?, speaker_filter?)` — AI Q&A with citations; speaker disambiguation built in
3. `summarise_sermon(date, speaker?)` — full Claude-synthesised summary of a sermon; speaker disambiguation + nearest-date fallback
4. `search_teachings(topic, speaker_filter?)` — topic search; speaker disambiguation built in

Shared helpers: `resolveSpeaker`, `fetchChunksByDateAndSpeaker`, `nearestDateMessage`.

### `frontend/` — React + Vite SPA
The entire member- and admin-facing UI is a single-page React app (TypeScript + Tailwind, mobile-responsive) built by Vite. The backend no longer renders HTML — it exposes JSON/SSE APIs under `/api/*` (plus the PDF download) and serves the built SPA. Key files:
- `frontend/src/App.tsx` — `react-router-dom` routes: `/` (chat), `/transcripts`, `/transcripts/:videoId`, `/admin`, `/admin/live`, `/lyrical-theology`, and a 404
- `frontend/src/api/client.ts` — typed fetch wrappers + the chat SSE reader (`streamChat`, an async generator yielding `delta`/`context`/`done`/`error` frames); `frontend/src/api/types.ts` mirrors the backend response shapes
- `frontend/src/pages/ChatPage.tsx` — message thread, streaming assistant bubbles (markdown via `marked`), collapsible "Sources", auto-growing input
- `frontend/src/pages/TranscriptsPage.tsx` — NL search box + structured filters (month/year/theme/speaker), responsive results table
- `frontend/src/pages/TranscriptViewPage.tsx` — single transcript, timestamped segments or paragraph fallback, Download PDF link
- `frontend/src/pages/AdminPage.tsx` — secret-gated stats + recent jobs, "Sync Now", 30 s auto-refresh
- `frontend/src/pages/LiveStatusPage.tsx` — phase stepper (Download → Transcribe → Chunk → Embed), queue + recent tables, polls every 2 s
- `frontend/src/pages/DbBrowserPage.tsx` — secret-gated paginated table explorer (BLOBs shown as `[blob: NB]`)
- The admin secret lives in `sessionStorage` (`frontend/src/lib/useAdminSecret.ts`) and is sent as `X-Admin-Secret`

In dev, the Vite dev server (`:5173`) serves the SPA and proxies `/api`, `/assets`, `/health`, `/mcp`, and `/transcripts/*/download` to the Hono server (`:3000`). In production, `yarn build:web` emits the SPA to `public/app/` and Hono serves it.

The app is an installable **PWA**: `vite-plugin-pwa` generates `sw.js` + `manifest.webmanifest` (served from `public/app` by the catch-all). The service worker precaches the app shell and runtime-caches only public read-only data (`/api/transcripts/*`, `/api/themes`, `/assets/*`); the live chat SSE (`/api/chat`) and secret-gated `/api/admin/*` and `/api/db/*` routes are deliberately network-only. Icons live in `public/assets/` (`pwa-192x192.png`, `pwa-512x512.png`, `maskable-512x512.png`).

### `src/web/transcriptPdf.ts`
`generateTranscriptPdf(sermon, transcript)` renders a transcript to a PDF `Buffer` with `pdfkit` (pure JS — no headless browser; sub-second even for a 2-hour sermon). `transcriptPdfFilename(sermon)` builds the `theme__title__month-year.pdf` download name (theme falls back to `sermon`).

### `src/web/transcriptQuery.ts`
`parseTranscriptQuery(text, anthropic)` uses the cheap `CHUNKING_MODEL` (wrapped in `withRetry`) to extract structured `{ date?, topic?, speaker? }` filters from a free-text request. `topic` is the subject the sermon should be *about* (e.g. "faith"), resolved by relevance — not a formal theme name. Returns `{}` on any parse failure so the route can fall back to a raw keyword search.

### `src/web/transcriptFormat.ts`
Pure formatting helpers shared by the transcripts table, view, and PDF: `formatSermonDate` ("4 July 2021"), `humanizeDatePrefix` ("February 2023"), `monthYearSlug` ("july-2021"), and `slugify`.

### `src/web/router.ts`
Hono app wiring all routes. The UI pages are client-side routes served by the SPA catch-all; this layer is JSON/SSE + static serving only.

**Chat**
- `POST /api/chat` — accepts `{ messages }` and runs an **agentic** Claude loop streamed over SSE. Claude is given two read-only tools (`CHAT_TOOLS`, dispatched by `runChatTool`): `search_sermon_excerpts` (FTS5 chunk search, a relevant sample) and `list_sermons` (the **complete** roster for a date/topic/speaker filter, via `resolveTranscriptSermons` — so enumeration questions like "all sermons that month" don't miss any). Returns 404 if the library is empty. The system prompt is cached (`cache_control`) so the tools+system prefix is cheap to reuse across the loop's calls

**Transcripts** — public, read-only transcript delivery
- `GET /api/themes` — returns `{ id, name }[]` for the structured filter dropdown
- `GET /api/transcripts/search` — accepts `q` (natural-language, parsed via `parseTranscriptQuery`) **or** structured `month`/`year`/`theme`/`topic`/`speaker` params; returns `{ interpreted, sermons[] }`. Filters combine (base set by priority topic > theme > date > speaker, then the rest applied as predicates). `topic` is a **relevance** search over each sermon's Claude-derived section topics/summaries (`searchSermonsByTopic`), ranked by density. Registered before `/api/transcripts/:videoId` so "search" isn't read as a video id
- `GET /api/transcripts/:videoId` — returns `{ sermon, segments, transcript, hasTranscript }` (rendered client-side from `transcriptions.segments`, or paragraphs from the verbatim text)
- `GET /transcripts/:videoId/download` — streams an on-demand PDF (`application/pdf`, `Content-Disposition: attachment`); the SPA links to it directly

**Admin** — protected by `X-Admin-Secret` middleware on `/api/admin/*`
- `GET /api/admin/status` — returns `{ queueDepth, lastSyncAt, sermonCount }`
- `POST /api/admin/sync-api` — triggers a background sync from the sermon REST API, returns `{ ok: true }` (202)
- `GET /api/admin/jobs` — returns recent job list (up to 50)
- `GET /api/admin/status/data` — returns `{ queueDepth, jobs }`; queued jobs include their 1-based `position`

**DB Browser** — protected by `X-Admin-Secret` middleware on `/api/db/*`
- `GET /api/db/:table` — returns paginated rows for `sermons`, `themes`, `transcriptions`, `chunks`, `jobs`, or `missing_sermons`; accepts `limit` and `offset` query params

**Static + SPA**
- `GET /favicon.ico`, `GET /assets/:file` — logos/icons from `public/assets`
- `GET /health` — `{ ok: true }`
- `GET *` (catch-all, registered last) — serves files from the Vite build in `public/app/`; falls back to `index.html` for any unmatched path so client-side routes resolve. Content-hashed `/static/*` assets get a 1-year immutable cache

### `src/main.ts`
Sequential startup:
1. `initDatabase()` — create/migrate SQLite tables
2. `loadEmbedder()` — warm up the embedding model
3. Raw `http.createServer()` — `/mcp` dispatches to a fresh `McpServer` per request;
   everything else passes through `getRequestListener(app.fetch)` (Hono)
4. `startScheduler(anthropic)` — registers cron job (every 10 h for 4 days, then daily 06:00)
5. `SIGTERM` / `SIGINT` handlers — wait for the active job to finish before exiting

---

## Data Flow: Web Chat

```
Member opens browser → GET / → SPA shell (public/app/index.html) → ChatPage

Member types question → POST /api/chat { messages: [...] }
    → 404 if countSermons() === 0
    → agentic loop (≤6 steps), each step = anthropic.messages.stream(... CHAT_TOOLS):
        stream { type: 'delta', text }            token by token
        finalMessage → stop_reason !== 'tool_use'? end loop
        else runChatTool() per tool_use block:
            search_sermon_excerpts → searchChunks(query, 10)   relevant sample
            list_sermons           → resolveTranscriptSermons  COMPLETE roster
            find_sermon            → findSermonsByTitle        named sermon + YouTube link
        { type: 'context', sources }              cumulative citations
        append tool_result blocks, continue
    → { type: 'done' }
    → Claude answers grounded only in tool results
```

## Data Flow: Transcripts

```
Member opens browser → GET /transcripts → SPA TranscriptsPage
    → GET /api/themes fills the theme dropdown (listThemes())

Member searches → GET /api/transcripts/search?q=... (or ?month=&year=&theme=&topic=&speaker=)
    → q present:  parseTranscriptQuery() → { date?, topic?, speaker? }
                  (nothing parsed → searchSermons() keyword fallback)
      structured: month+year → date prefix; theme/topic/speaker applied directly
    → resolveTranscriptSermons(): base by priority topic > theme > date > speaker,
      then remaining filters applied. topic = relevance search over section
      topics/summaries (searchSermonsByTopic), ranked by density
    → JSON { interpreted, sermons: [{ title, dateFormatted, theme, excerpt,
             hasTranscript, viewUrl, downloadUrl }] }

Member clicks a title → SPA route /transcripts/:videoId → GET /api/transcripts/:videoId
    → getTranscriptionBySermonId() → JSON { sermon, segments, transcript } (timestamped segments)

Member clicks Download → GET /transcripts/:videoId/download
    → generateTranscriptPdf(sermon, transcript)  pdfkit, on demand
    → application/pdf, attachment; filename=theme__title__month-year.pdf
```

## Data Flow: Ingestion

```
Scheduler triggers sync on startup (and on cron), or admin clicks "Sync Now" (POST /admin/sync-api)
    → syncFromApi() calls fetchAllSermons() and enqueues new sermons
    → queue.enqueue(job)        returns jobId immediately

Meanwhile, in background:
    pipeline.ingestSermon(req)
        → videoId = req.videoId ?? SHA256(downloadUrl)[:16]
        → check for existing record
        → if ingestion_status='transcribed':
              read transcriptions table (or legacy sermons.transcription) → skip to chunking
          else:
              downloader.download(downloadUrl)   temp file
              transcriber.transcribeAudio(file)  OpenAI Whisper API → segments + transcript + duration
              duration > MAX → return { status: 'too_long' }
              queries.insertPartialSermon()      saves partial sermon record
              queries.insertTranscription()      saves transcript + segments to transcriptions table
        → chunker.chunkSermon(segments)         Claude API call
        → embedder.embed(chunk.content)         for each chunk
        → queries.saveChunks + completeSermon   write chunks, set status='done'
        → cleanup()                             delete temp file
    → job.status = 'done' | 'failed'
```

## Data Flow: MCP Query

```
Claude Desktop → POST /mcp
    → StreamableHTTPServerTransport (fresh per request)
    → McpServer dispatches tool call

e.g. summarise_sermon("2024-03-12", "Apostle")
    → resolveSpeaker("Apostle")          exact match or disambiguation
    → fetchChunksByDateAndSpeaker(...)   nearest-date fallback if needed
    → Anthropic API                      Claude synthesis
    → return narrative text

e.g. ask_church("What was taught about faith?")
    → searchChunks("What was...")        FTS5 query
    → Anthropic API                      answer with citations
    → return answer text
```

---

## Database Schema

```sql
-- One row per theme; keyed on the upstream API theme id so links survive renames
CREATE TABLE themes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id   TEXT UNIQUE NOT NULL,  -- upstream API theme _id
    name       TEXT NOT NULL,
    slug       TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per MP3
CREATE TABLE sermons (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id         TEXT UNIQUE NOT NULL,  -- API _id, or SHA256(downloadUrl)[:16]
    title            TEXT NOT NULL,
    date             TEXT NOT NULL,         -- YYYY-MM-DD
    download_url     TEXT NOT NULL,         -- original MP3 URL
    webpage_url      TEXT,                  -- optional source page
    speaker          TEXT NOT NULL,         -- required
    excerpt          TEXT,                  -- short summary from the listing API
    theme_id         INTEGER REFERENCES themes(id),  -- FK to themes
    description      TEXT,                  -- from API description_string
    duration         INTEGER,               -- seconds
    tags             TEXT,                  -- JSON array
    ingestion_status TEXT NOT NULL DEFAULT 'done',  -- 'transcribed' | 'done'
    transcription    TEXT,                  -- legacy field, kept for compat; new rows use transcriptions table
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plain-text transcript + JSON segments stored separately to avoid bloating sermon queries
CREATE TABLE transcriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sermon_id  INTEGER UNIQUE NOT NULL REFERENCES sermons(id),
    transcript TEXT NOT NULL,   -- full plain-text from Whisper API
    segments   TEXT NOT NULL,   -- JSON-encoded TranscriptSegment[]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Many rows per sermon
CREATE TABLE chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sermon_id       INTEGER NOT NULL REFERENCES sermons(id),
    section_name    TEXT NOT NULL,
    content         TEXT NOT NULL,
    timestamp_start REAL NOT NULL,
    timestamp_end   REAL NOT NULL,
    topics          TEXT,               -- JSON array
    summary         TEXT,
    embedding       BLOB                -- Float32[384], future vector search
);

-- Full-text search (auto-synced via 3 triggers)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content, summary, topics,
    content_rowid='id', content='chunks'
);

-- Job queue persistence
CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,      -- UUID
    title        TEXT,
    download_url TEXT,
    payload      TEXT,                  -- JSON of original IngestRequest (for retry)
    status       TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'running' | 'done' | 'failed'
    phase        TEXT,                  -- running sub-step: 'downloading'|'transcribing'|'chunking'|'embedding'
    message      TEXT,                  -- success/failure summary
    error        TEXT,                  -- error message on failure
    created_at   TEXT NOT NULL,
    started_at   TEXT,
    completed_at TEXT
);

-- Sermons that failed to ingest (no audio path, too long, timeout, error).
-- Server-restart failures are NOT recorded here.
CREATE TABLE missing_sermons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id     TEXT UNIQUE NOT NULL,    -- API _id, so retries upsert
    title        TEXT NOT NULL,
    date         TEXT,
    download_url TEXT,
    webpage_url  TEXT,
    speaker      TEXT,
    theme        TEXT,
    kind         TEXT NOT NULL DEFAULT 'error',  -- no_audio | too_long | timeout | error
    reason       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The ingestion pipeline upserts a `missing_sermons` row whenever it returns `error`/`too_long`, and deletes the row once the same `video_id` ingests successfully. A `download_url` equal to `AUDIO_BASE_URL` (the API source builds this when `audio_url` is blank) short-circuits before download as `kind = 'no_audio'`. `kind = 'timeout'` marks transient failures that the next API sync retries. Browse it at `/lyrical-theology`.

Migration shims in `schema.ts` handle existing databases: `ALTER TABLE` statements run only when a column is absent, so an old DB survives an upgrade without data loss.

---

## Docker Build

The image uses a two-stage build to keep the runtime image small:

```
Stage 1 — builder (node:20, Debian Bookworm)
    apt-get install build-essential python3  ← compile better-sqlite3 native addon
    COPY package.json yarn.lock + frontend/package.json  ← workspace manifests
    yarn install --frozen-lockfile           ← installs backend + frontend (workspaces)
    yarn build                               ← vite build → public/app/, esbuild → dist/

Stage 2 — runtime (node:20-slim, same Debian Bookworm)
    apt-get install ffmpeg           ← re-encodes audio > 25 MB before Whisper API upload
                    libstdc++6       ← C++ runtime stripped from node:20-slim, needed by
                    libgomp1            better-sqlite3
    COPY dist/ node_modules/ package.json public/ from builder  ← public/ includes the SPA build
```

Both stages use the same Debian Bookworm base so compiled `.node` binaries are portable between them (same glibc ABI).

**Layer caching:** `apt-get` and `yarn install` layers are cached until `yarn.lock` or either `package.json` changes. Code changes only invalidate the final `COPY . .` + `yarn build` layers, making rebuilds fast.

---

## Database Backup (Litestream + R2)

When the four R2 environment variables are set (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`), the container starts under Litestream instead of running Node directly.

### How it works

```
Container start (with R2 vars set)
    │
    docker-entrypoint.sh
    │
    litestream replicate -config litestream.yml -exec "node dist/main.js"
    │
    ├── 1. Restore — downloads the latest snapshot + WAL frames from R2 to $DB_PATH
    │             (no-op on first boot if the bucket is empty)
    │
    ├── 2. Node starts — app opens the restored SQLite file normally
    │
    └── 3. Continuous replication — Litestream monitors the WAL and streams changes
              to R2 in near-real-time while Node is running
              (sync interval: 30 s)

Container stop / crash
    └── Litestream flushes remaining WAL frames before exiting;
        next cold start restores from where replication left off
```

### Graceful degradation

`docker-entrypoint.sh` checks all four R2 vars at runtime. If any is absent, it falls back to `node dist/main.js` directly — Litestream is never invoked and the app starts normally. This means local development and staging environments without R2 credentials work identically to before.

### Config file

`litestream.yml` at the repo root uses env-var substitution (`${VAR}`) so no credentials are baked into the image. The replica path inside the bucket is `sermons/`, a stable prefix reused across deploys so restores can find the previous replica.

### Dated archive exports

Litestream object names under `sermons/generations/...` are internal IDs, not human-readable recovery labels. For operator-friendly inspection, the app also writes dated plain SQLite exports to R2 when the same four R2 env vars are configured:

```text
archives/sermons-2026-06-08T22-15-00Z.db
```

These archive files are created with SQLite's online backup API, so they are consistent even while the app is running. They are for manual download/inspection and coarse recovery. Litestream remains the primary continuous restore mechanism because it can replay WAL files to the latest replicated transaction.

### Recovery procedure

To restore a database manually (e.g. migrating to a new Railway project):

```bash
litestream restore -config litestream.yml $DB_PATH
```

Litestream downloads the latest snapshot and applies all subsequent WAL frames, producing a consistent SQLite file.
