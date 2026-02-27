# Kerygma — Architecture

## Overview

One Node.js process. One port (3000). Two jobs:
1. **Admin UI** — lets a church admin paste an MP3 link and ingest a sermon
2. **MCP Server** — lets Claude answer questions about sermons

```
Browser (Admin)
    │  POST /admin/ingest (form data)
    ▼
Hono HTTP Server (:3000)
    ├── GET  /admin          → Admin form page (password-protected)
    ├── POST /admin/ingest   → Add job to queue → 202 + jobId
    ├── GET  /admin/jobs     → List recent job statuses
    ├── GET  /admin/jobs/:id → Poll a single job
    └── GET  /health         → { ok: true }
         │
    In-process job queue (FIFO, sequential — one job at a time)
         │
    Ingestion Pipeline
         ├── 1. Download MP3 → temp file
         ├── 2. nodejs-whisper → TranscriptSegment[]
         ├── 3. Claude → semantic chunks (section_name, timestamps, topics, summary)
         ├── 4. @xenova/transformers → 384-dim embedding per chunk
         └── 5. better-sqlite3 → write sermons + chunks to SQLite

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

Key variables: `ANTHROPIC_API_KEY`, `ADMIN_SECRET`, `MINISTRY_NAME` (used in UI titles and AI system prompts), `WHISPER_MODEL` (must match the model baked into the Docker image).

### `src/db/schema.ts`
Defines the SQLite DDL:
- `sermons` table — one row per ingested MP3
- `chunks` table — many rows per sermon (each chunk = one section of the sermon)
- `chunks_fts` — virtual FTS5 table for full-text search (auto-synced via triggers)
- Migration shims — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so an existing DB
  keeps working after adding new columns

### `src/db/connection.ts`
Creates a single `better-sqlite3` instance and runs `initDatabase()` once at startup.
All other modules import this singleton — no connection pooling needed for SQLite.

### `src/db/queries.ts`
Typed functions for every DB operation:
- `saveSermon(data)` → `number` (sermon id)
- `saveChunks(sermonId, chunks[])` — uses `db.transaction()` for atomicity
- `insertPartialSermon(data)` → `number` — saves a partially-ingested sermon with `ingestion_status='transcribed'` and raw transcription JSON
- `completeSermon(id)` — sets `ingestion_status='done'`, clears `transcription`
- `getSermonByVideoId(id)` → `SermonRow | null`
- `getSermonsByDate(date)` → `SermonRow[]`
- `getNearestSermonByDate(date)` → `SermonRow | null` — closest sermon when exact date has no results
- `getSpeakersMatchingFilter(filter)` → `string[]` — distinct speaker names matching substring
- `getChunksBySermonId(id)` → `ChunkRow[]`
- `searchChunks(query, limit)` → `ChunkWithSermon[]`
- `listSermons(limit)` → `SermonRow[]`

### `src/ingestion/downloader.ts`
Streams an MP3 URL to a temp file using native `fetch`.
Returns `{ filePath, cleanup }` — caller always calls `cleanup()` in a `finally` block.
Uses `AbortSignal.timeout(5 * 60 * 1000)` to cap download time.

### `src/ingestion/transcriber.ts`
Calls `nodejs-whisper` (Node bindings for whisper.cpp) on the temp file.
nodejs-whisper converts the MP3 to WAV first, then runs `whisper-cli` on the WAV.
whisper-cli writes the sidecar as `<file>.wav.json` (not `<file>.json`).
The transcriber reads that path, maps timestamps from ms → seconds, then deletes the sidecar and WAV.
Returns `{ segments: TranscriptSegment[], duration: number }`.

### `src/ingestion/chunker.ts`
- Formats transcript as `[MM:SS] text` lines
- Sends to Claude with a semantic chunking prompt
- Parses JSON response
- Runs `validateChunks` (sort → fill gaps/overlaps in one pass)
- Attaches content text to each chunk
- Exports `formatTimestamp` (used by MCP tools too)

### `src/ingestion/embedder.ts`
Loads `Xenova/all-MiniLM-L6-v2` once at startup (~90MB download on first run).
`generateEmbedding(text)` returns a `Buffer` of raw Float32 bytes (384 floats = 1536 bytes).
Stored in `chunks.embedding BLOB` for future vector search — not queried yet.

### `src/ingestion/pipeline.ts`
Orchestrates the full ingestion flow for one sermon:
```
hash URL → check existing record
  → if ingestion_status='transcribed': resume from stored transcription (skip download)
  → if ingestion_status='done': return duplicate
  → else: download → transcribe → insertPartialSermon (saves transcription to DB)
            → chunk → embed each chunk → completeSermon (sets status='done', clears transcription)
            → cleanup temp file
```
`try/finally` guarantees the temp file is always deleted.
The partial-record step means a retry after a chunking failure skips re-download and re-transcription.
Returns `{ status: 'ok' | 'duplicate' | 'too_long' | 'error', message, sermonId? }`.

Input:
```ts
{ downloadUrl, webpageUrl?, title, speaker, date, series?, tags? }
```
`series` is stored as `${series}-${year}` (e.g. `Faith Foundations-2024`). Speaker is required.

### `src/queue.ts`
In-process FIFO queue. One `Map<string, Job>` + one string array of IDs.
- `enqueue(fn)` → UUID — pushes a job, triggers `drain()` if nothing running
- `drain()` — pops jobs one at a time; a failed job logs the error and moves on
- `getJob(id)` / `getRecentJobs(n)` — for admin status polling
- `waitUntilIdle()` — used during graceful shutdown

### `src/mcp/server.ts`
`createMcpServer(anthropic)` — accepts an injected Anthropic client.
Registers 4 tools:
1. `list_sermons(limit)` — list indexed sermons
2. `ask_church(question, date_filter?, speaker_filter?)` — AI Q&A with citations; speaker disambiguation built in
3. `summarise_sermon(date, speaker?)` — full Claude-synthesised summary of a sermon; speaker disambiguation + nearest-date fallback
4. `search_teachings(topic, speaker_filter?)` — topic search; speaker disambiguation built in

Shared helpers: `resolveSpeaker`, `fetchChunksByDateAndSpeaker`, `nearestDateMessage`.

### `src/web/adminHtml.ts`
Returns an HTML string — the admin page. Contains:
- A form: MP3 URL, webpage URL, title, speaker, date, tags
- Client-side JS that `fetch`-POSTs with `X-Admin-Secret` header
- Polls `/admin/jobs/:id` every 3s until terminal state
- Shows a live job status table

### `src/web/router.ts`
Hono app wiring all admin routes together.
- Admin routes are behind an `X-Admin-Secret` middleware check
- `/mcp` is handled at the raw Node HTTP level in `main.ts` (not inside Hono) to avoid
  double-response writes when MCP transport closes the Node `ServerResponse` directly

### `src/main.ts`
Sequential startup:
1. `initDatabase()` — create/migrate SQLite tables
2. `loadEmbedder()` — warm up the embedding model
3. Raw `http.createServer()` — `/mcp` dispatches to a fresh `McpServer` per request;
   everything else passes through `getRequestListener(app.fetch)` (Hono)
4. `SIGTERM` / `SIGINT` handlers — wait for the active job to finish before exiting

---

## Data Flow: Ingestion

```
Admin submits form
    → POST /admin/ingest
    → queue.enqueue(job)        returns jobId immediately (202)
    → browser polls /admin/jobs/:jobId

Meanwhile, in background:
    pipeline.ingestSermon(req)
        → hash downloadUrl → check for existing record
        → if ingestion_status='transcribed':
              parse stored transcription → skip to chunking
          else:
              downloader.download(downloadUrl)  temp file
              transcriber.transcribe(file)      segments + duration
              duration > MAX → return { status: 'too_long' }
              queries.insertPartialSermon()     saves transcription to DB
        → chunker.chunkSermon(data)            Claude API call
        → embedder.embed(chunk.content)        for each chunk
        → queries.saveChunks + completeSermon  write chunks, clear transcription
        → cleanup()                            delete temp file
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
-- One row per MP3
CREATE TABLE sermons (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id         TEXT UNIQUE NOT NULL,  -- SHA256(downloadUrl)[:16]
    title            TEXT NOT NULL,
    date             TEXT NOT NULL,         -- YYYY-MM-DD
    download_url     TEXT NOT NULL,         -- original MP3 URL
    webpage_url      TEXT,                  -- optional source page
    speaker          TEXT NOT NULL,         -- required
    series           TEXT,                  -- e.g. "Faith Foundations-2024"
    duration         INTEGER,               -- seconds
    tags             TEXT,                  -- JSON array
    ingestion_status TEXT NOT NULL DEFAULT 'done',  -- 'transcribed' | 'done'
    transcription    TEXT,                  -- raw JSON, cleared after chunking
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
```

Migration shims in `schema.ts` handle existing databases: `ALTER TABLE` statements run only when a column is absent, so an old DB survives an upgrade without data loss.

---

## Docker Build

The image uses a two-stage build to keep the runtime image small:

```
Stage 1 — builder (node:20, Debian Bookworm)
    apt-get install cmake build-essential python3 wget
    yarn install --frozen-lockfile          ← compiles better-sqlite3
    cmake -DGGML_NATIVE=OFF ...             ← compiles whisper-cli (native CPU
                                               detection disabled for Docker compat)
    wget ggml-small.en.bin                  ← bakes Whisper model into image layer
    NODE_OPTIONS=--max-old-space-size=4096  ← tsc needs >2GB heap
    yarn build                              ← tsc → dist/

Stage 2 — runtime (node:20-slim, same Debian Bookworm)
    apt-get install ffmpeg           ← needed at runtime for MP3→WAV conversion
    COPY dist/ node_modules/ package.json from builder
```

Both stages use the same Debian Bookworm base so compiled `.node` binaries are portable between them (same glibc ABI).

**Layer caching:** `apt-get` and `yarn install` layers are cached until `yarn.lock` changes. Code changes only invalidate the final `COPY . .` + `yarn build` layers, making rebuilds fast.

To use a different Whisper model at build time:
```bash
docker build --build-arg WHISPER_MODEL=small.en -t kerygma .
```
