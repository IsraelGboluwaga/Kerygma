# Kerygma — Architecture

## Overview

One Node.js process. One port (3000). Three jobs:
1. **Web Chat UI** — lets church members ask questions about sermons
2. **Admin UI** — lets a church admin ingest MP3 sermons via a password-gated form
3. **MCP Server** — lets Claude Desktop (or any MCP client) query sermons programmatically

```
Browser (Member)
    │  GET  /              → Chat UI (HTML)
    │  POST /              → SSE stream (Claude answer)
    ▼
Browser (Admin)
    │  GET  /admin             → Admin UI (HTML, password-gated)
    │  GET  /admin/live        → Live status dashboard (HTML)
    │  GET  /admin/status      → Stats snapshot (JSON: queueDepth, lastSyncAt, sermonCount)
    │  POST /admin/sync-api    → Trigger background API sync → 202 (protected)
    │  GET  /admin/jobs        → List recent job statuses (protected)
    │  GET  /admin/status/data → Live queue + phase snapshot (JSON, protected)
    ▼
Hono HTTP Server (:3000)
    └── GET /health        → { ok: true }
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

Key required variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ADMIN_SECRET`, `SERMON_BASE_URL`, `AUDIO_BASE_URL`. Optional: `MINISTRY_NAME`, `CHUNKING_MODEL`, `CLAUDE_MODEL`, `MAX_AUDIO_DURATION_SECONDS`, `DB_PATH`, `PORT`.

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
Tue + Fri at 06:00 (`'0 6 * * 2,5'`) for ongoing syncs. The phase switch is handled via a
`setTimeout` that stops the frequent task and starts the weekly one.
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

### `src/web/dbHtml.ts`
Returns the HTML string for the DB browser (`GET /lyrical-theology`). Contains:
- A password field (uses `X-Admin-Secret` for data requests)
- A table selector for `sermons`, `themes`, `transcriptions`, `chunks`, and `jobs`
- A paginated data grid with BLOB columns rendered as `[blob: NB]`
- Client-side fetch against `GET /lyrical-theology/:table?limit=&offset=`

### `src/web/chatHtml.ts`
Returns the HTML string for the member-facing chat UI. Contains:
- A message thread view (user bubbles right, assistant bubbles left)
- Client-side SSE reader that streams Claude's response token by token
- A collapsible "Sources" widget showing which sermon chunks informed each answer
- New Conversation button

### `src/web/adminHtml.ts`
Returns the HTML string for the admin dashboard page. Contains:
- A password field — stats and job list are loaded only after the correct `ADMIN_SECRET` is accepted (verified via `GET /admin/status`; 401 keeps the data hidden)
- A stats row: sermons indexed, queue depth, last sync timestamp
- A "Sync Now" button that POSTs to `POST /admin/sync-api` and refreshes the job list after 3 s
- A recent jobs table (title, status badge, message); auto-refreshes every 30 s
- A "Live status →" link to `/admin/live`

### `src/web/statusHtml.ts`
Returns the HTML string for the live status dashboard (`GET /admin/live`). Contains:
- A password field (remembered in `sessionStorage`) so it can be shared with the admin page
- A "Now Processing" phase stepper (Download → Transcribe → Chunk → Embed) for the currently running job, driven by the job's `phase` field
- A queue list showing each waiting job's 1-based position, plus a recent-jobs table
- Client-side JS that polls `GET /admin/status/data` every 2s — progress lives in structured job state, not in the logs

### `src/web/transcriptsHtml.ts`
Returns the HTML string for the transcripts page (`GET /transcripts`). Contains:
- A natural-language search box (e.g. "sermons in February 2023", "all sermons on faith")
- A collapsible structured-filter panel: month + year + theme (dropdown populated server-side from `listThemes()`) + speaker
- A mobile-responsive results table (real `<table>` on wide screens, stacked cards under 640px) with title (linked to the transcript view), formatted date, theme tag, excerpt, and a Download PDF link
- Client-side JS that calls `GET /transcripts/search` and renders the rows

### `src/web/transcriptViewHtml.ts`
Returns the HTML string for a single viewable transcript (`GET /transcripts/:videoId`). Renders the sermon title + meta, a "Download PDF" button, and the transcript body — timestamped per segment when `transcriptions.segments` is present, otherwise plain paragraphs from the verbatim text.

### `src/web/transcriptPdf.ts`
`generateTranscriptPdf(sermon, transcript)` renders a transcript to a PDF `Buffer` with `pdfkit` (pure JS — no headless browser; sub-second even for a 2-hour sermon). `transcriptPdfFilename(sermon)` builds the `theme__title__month-year.pdf` download name (theme falls back to `sermon`).

### `src/web/transcriptQuery.ts`
`parseTranscriptQuery(text, anthropic)` uses the cheap `CHUNKING_MODEL` (wrapped in `withRetry`) to extract structured `{ date?, topic?, speaker? }` filters from a free-text request. `topic` is the subject the sermon should be *about* (e.g. "faith"), resolved by relevance — not a formal theme name. Returns `{}` on any parse failure so the route can fall back to a raw keyword search.

### `src/web/transcriptFormat.ts`
Pure formatting helpers shared by the transcripts table, view, and PDF: `formatSermonDate` ("4 July 2021"), `humanizeDatePrefix` ("February 2023"), `monthYearSlug` ("july-2021"), and `slugify`.

### `src/web/router.ts`
Hono app wiring all routes:

**Chat (`/`)**
- `GET /` — serves the chat UI
- `POST /` — accepts `{ messages }`, searches chunks using the last user message (FTS5, stopword-filtered, OR semantics), builds a system prompt with matching excerpts (title | speaker | date | timestamp | URL), streams a Claude SSE response

**Transcripts (`/transcripts/*`)** — public, read-only transcript delivery
- `GET /transcripts` — serves the transcripts search/table UI (HTML)
- `GET /transcripts/search` — accepts `q` (natural-language, parsed via `parseTranscriptQuery`) **or** structured `month`/`year`/`theme`/`topic`/`speaker` params; returns `{ interpreted, sermons[] }`. Filters combine (base set by priority topic > theme > date > speaker, then the rest applied as predicates). `topic` is a **relevance** search over each sermon's Claude-derived section topics/summaries (`searchSermonsByTopic`), ranked by density — so "faith" returns sermons *geared towards* faith, not every sermon that says the word. Registered before `/transcripts/:videoId` so "search" isn't read as a video id
- `GET /transcripts/:videoId` — serves the viewable transcript (HTML, rendered from `transcriptions.segments`)
- `GET /transcripts/:videoId/download` — streams an on-demand PDF (`application/pdf`, `Content-Disposition: attachment`)

**Admin (`/admin/*`)** — data/action routes protected by `X-Admin-Secret` middleware; the two HTML pages (`/admin`, `/admin/live`) are public and prompt for the secret client-side
- `GET /admin` — serves the admin dashboard UI
- `GET /admin/live` — serves the live phase/queue status dashboard (HTML)
- `GET /admin/status` — returns `{ queueDepth, lastSyncAt, sermonCount }` (protected)
- `POST /admin/sync-api` — triggers a background sync from the sermon REST API, returns `{ ok: true }` (202, protected)
- `GET /admin/jobs` — returns recent job list (up to 50, protected)
- `GET /admin/status/data` — returns `{ queueDepth, jobs }`; queued jobs include their 1-based `position` (protected)

**DB Browser (`/lyrical-theology/*`)** — password-gated read-only table explorer
- `GET /lyrical-theology` — serves the DB browser UI (HTML)
- `GET /lyrical-theology/:table` — returns paginated rows for `sermons`, `themes`, `transcriptions`, `chunks`, or `jobs` (protected); accepts `limit` and `offset` query params

### `src/main.ts`
Sequential startup:
1. `initDatabase()` — create/migrate SQLite tables
2. `loadEmbedder()` — warm up the embedding model
3. Raw `http.createServer()` — `/mcp` dispatches to a fresh `McpServer` per request;
   everything else passes through `getRequestListener(app.fetch)` (Hono)
4. `startScheduler(anthropic)` — registers cron job (every 10 h for 4 days, then Tue + Fri 06:00)
5. `SIGTERM` / `SIGINT` handlers — wait for the active job to finish before exiting

---

## Data Flow: Web Chat

```
Member opens browser → GET /
    → chatHtml served

Member types question → POST / { messages: [...] }
    → find last user message
    → searchChunks(lastUserMessage, 10)   FTS5, stopwords filtered, OR semantics
    → build system prompt with chunk excerpts (title | speaker | date | URL)
    → stream SSE response:
        { type: 'context', sources }      sent first (populates Sources widget)
        { type: 'delta', text }           streamed token by token
        { type: 'done' }
    → Claude answers based solely on provided excerpts
```

## Data Flow: Transcripts

```
Member opens browser → GET /transcripts
    → transcriptsHtml served (theme dropdown filled from listThemes())

Member searches → GET /transcripts/search?q=... (or ?month=&year=&theme=&topic=&speaker=)
    → q present:  parseTranscriptQuery() → { date?, topic?, speaker? }
                  (nothing parsed → searchSermons() keyword fallback)
      structured: month+year → date prefix; theme/topic/speaker applied directly
    → resolveTranscriptSermons(): base by priority topic > theme > date > speaker,
      then remaining filters applied. topic = relevance search over section
      topics/summaries (searchSermonsByTopic), ranked by density
    → JSON { interpreted, sermons: [{ title, dateFormatted, theme, excerpt,
             hasTranscript, viewUrl, downloadUrl }] }

Member clicks a title → GET /transcripts/:videoId
    → getTranscriptionBySermonId() → transcriptViewHtml (timestamped segments)

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
```

Migration shims in `schema.ts` handle existing databases: `ALTER TABLE` statements run only when a column is absent, so an old DB survives an upgrade without data loss.

---

## Docker Build

The image uses a two-stage build to keep the runtime image small:

```
Stage 1 — builder (node:20, Debian Bookworm)
    apt-get install build-essential python3  ← compile better-sqlite3 native addon
    yarn install --frozen-lockfile
    yarn build                               ← esbuild → dist/ (transpile only, no type check)

Stage 2 — runtime (node:20-slim, same Debian Bookworm)
    apt-get install ffmpeg           ← re-encodes audio > 25 MB before Whisper API upload
                    libstdc++6       ← C++ runtime stripped from node:20-slim, needed by
                    libgomp1            better-sqlite3
    COPY dist/ node_modules/ package.json from builder
```

Both stages use the same Debian Bookworm base so compiled `.node` binaries are portable between them (same glibc ABI).

**Layer caching:** `apt-get` and `yarn install` layers are cached until `yarn.lock` changes. Code changes only invalidate the final `COPY . .` + `yarn build` layers, making rebuilds fast.

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
              (target checkpoint interval: 1 s)

Container stop / crash
    └── Litestream flushes remaining WAL frames before exiting;
        next cold start restores from where replication left off
```

### Graceful degradation

`docker-entrypoint.sh` checks all four R2 vars at runtime. If any is absent, it falls back to `node dist/main.js` directly — Litestream is never invoked and the app starts normally. This means local development and staging environments without R2 credentials work identically to before.

### Config file

`litestream.yml` at the repo root uses env-var substitution (`${VAR}`) so no credentials are baked into the image. The replica path inside the bucket is `sermons/`.

### Recovery procedure

To restore a database manually (e.g. migrating to a new Railway project):

```bash
litestream restore -config litestream.yml $DB_PATH
```

Litestream downloads the latest snapshot and applies all subsequent WAL frames, producing a consistent SQLite file.
