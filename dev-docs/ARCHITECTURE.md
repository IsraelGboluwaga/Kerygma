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
    └── better-sqlite3 reads (hybrid FTS5 + vector search + Claude synthesis)
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
- `getDoneVideoIds()` → `Set<string>` — all fully-ingested (`ingestion_status='done'`) video_ids; loaded once per API sync for in-memory skip checks
- `getSermonsByDate(date)` → `SermonRow[]`
- `getNearestSermonByDate(date)` → `SermonRow | null` — closest sermon when exact date has no results
- `getSpeakersMatchingFilter(filter)` → `string[]` — distinct speaker names matching substring
- `getChunksBySermonId(id)` → `ChunkRow[]`
- `searchChunks(query, limit, speaker?)` → `ChunkWithSermon[]` — FTS5 search with stopword filtering and OR semantics; meaningful keywords are matched against any chunk, ranked by relevance. The optional `speaker` is matched (case-insensitive substring) inside the SQL query itself, before the `LIMIT`, so a speaker filter narrows the ranked set instead of discarding rows from an already-limited top-N sample. This is now the **lexical leg** of hybrid retrieval (`src/retrieval.ts`) as well as the FTS primitive used directly by tests
- `getChunkEmbeddings(speaker?)` → `ChunkEmbeddingRow[]` — every stored chunk embedding (`id` + raw 384-dim Float32 blob) for the brute-force semantic scan; the optional `speaker` applies the same substring filter as `searchChunks` so the vector candidate set honours the same narrowing. Rows without an embedding are excluded
- `getChunksByIds(ids)` → `ChunkWithSermon[]` — hydrates a set of chunk ids into full citation rows (same shape as `searchChunks`); used by `hybridSearchChunks` to fetch the rows that arrived via the vector path alone. Order is not preserved (caller reorders to the fused ranking)
- `getSermonsBySpeaker(speaker)` → `SermonRow[]` — speaker/alias substring match done in SQL (not a broad fetch-then-filter-in-JS)
- `getSermonIdsWithTranscription(sermonIds)` → `Set<number>` — batched `hasTranscript` existence check for a page of sermon rows (one query, not one per row)
- `getTableColumns` / `getTableRowCount` / `getTableRows` / `DB_BROWSER_TABLES` — the DB browser's raw-SQL access, validated against the `DB_BROWSER_TABLES` allow-list (table names can't be bound as query params)
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
Loads `Xenova/all-MiniLM-L6-v2` once at startup (~90MB download on first run). The
`@xenova/transformers` version is **pinned** (exact, not `^`) so the model build — and
therefore the vector space — can't drift under a reinstall; every chunk and every query must
be embedded by the identical build or cosine comparisons between them are invalid.
`generateEmbedding(text)` returns a `Buffer` of raw Float32 bytes (384 floats = 1536 bytes),
L2-normalised (`normalize: true`) so cosine similarity reduces to a dot product. Stored in
`chunks.embedding BLOB` and queried by the hybrid retrieval path (`src/retrieval.ts`): the same
embedder embeds the incoming query, which is scored against these vectors.

MiniLM truncates at ~256 word-pieces, so a long chunk's tail would never reach its vector.
`generateEmbedding` avoids that: `splitIntoWindows` splits text over `EMBED_MAX_WORDS` (180)
into overlapping windows (`EMBED_WINDOW_OVERLAP` = 20 words), each window is embedded, and the
per-window unit vectors are mean-pooled and re-normalised into one unit vector — so the whole
section is represented while the single-vector-per-chunk storage shape (and the retrieval scan)
is unchanged. Short text and every chat query stay a single window, byte-identical to the
previous single-pass behaviour. Only long chunks re-embedded on a future ingest gain the fuller
vector; old and new vectors remain comparable (same model, both unit vectors), so no forced
re-embed.

### `src/retrieval.ts`
Hybrid excerpt retrieval — the search path behind the chat's `search_sermon_excerpts`
tool and the MCP `ask_church`/`search_teachings` tools. Fuses two candidate rankings:
- **lexical** — `searchChunks` (FTS5 `MATCH ... ORDER BY rank`)
- **semantic** — cosine similarity of the query embedding against every stored chunk vector

Fusion is **Reciprocal Rank Fusion** (`score = Σ 1/(k + rank)`, `k = 60`), which combines by
*rank* rather than raw score, so it never has to normalise BM25's rank metric against cosine
similarity. `CANDIDATE_K = 50` candidates are pulled from each leg, fused, and truncated to the
requested `limit` (`DEFAULT_RESULT_K = 15`, a reranked bump from the old fixed top-10).

Vector search is a **brute-force in-process scan** — the simplest thing that holds at the current
corpus size (one church's library, ~10³–10⁴ chunks): a linear dot-product scan over normalised
384-d vectors is single-digit-to-tens-of-ms and needs no native ANN dependency or index to
maintain, matching the single-singleton, no-pooling SQLite design. Scan time is logged (debug,
escalating to warn past ~50 ms) so the crossover to `sqlite-vec`/an ANN index (~100k chunks) stays
measurable. `hybridSearchChunks` degrades to FTS-only if the embedder is still warming up or the
query embeds to a degenerate zero vector — chat keeps working during startup. Embedding blobs are
length-validated and copied into an aligned buffer before decode (guards truncated rows and Node
Buffer-pool misalignment). `getChunkEmbeddings`/`getChunksByIds`/`searchChunks` keep all SQL in
`queries.ts`; the cosine + fusion math (not SQL) lives here.

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
On startup, calls `syncFromApi()` immediately so a fresh deploy doesn't wait until the next
06:00 for the first batch. Then registers a single `node-cron` job that runs daily at 06:00
(`'0 6 * * *'`) for ongoing syncs.

`syncFromApi` enqueues every sermon from the API except those already fully ingested
(`ingestion_status === 'done'`). The done check is an in-memory `Set` membership test: the run
loads all done video_ids up front via `getDoneVideoIds()` (one query) rather than a per-sermon
DB lookup while walking the API roster. Partial rows (status `transcribed` — e.g. a prior chunking
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

Job phases are reported through the `setPhase` callback, giving the status dashboard live sub-step visibility without adding log volume. Ingestion uses `downloading → transcribing → chunking → embedding`; book generation uses `retrieving → outlining → drafting → rendering`.

### `src/citations.ts`
`formatSermonExcerpt`/`formatSermonExcerpts` — the shared `[title | ... | timestamp | URL]\ncontent` excerpt format (and its `EXCERPT_CONTENT_CAP` truncation length) used by both the MCP server's `buildContext()` and the chat's `search_sermon_excerpts` tool, so the citation format and cap live in one place instead of two independently-maintained copies.

### `src/mcp/server.ts`
`createMcpServer(anthropic)` — accepts an injected Anthropic client.
Registers 4 tools:
1. `list_sermons(limit)` — list indexed sermons
2. `ask_church(question, date_filter?, speaker_filter?)` — AI Q&A with citations; speaker disambiguation built in
3. `summarise_sermon(date, speaker?)` — full Claude-synthesised summary of a sermon; speaker disambiguation + nearest-date fallback
4. `search_teachings(topic, speaker_filter?)` — topic search; speaker disambiguation built in

Shared helpers: `resolveSpeaker`, `fetchChunksByDateAndSpeaker`, `nearestDateMessage`, `textResult`/`textContent` (build a `CallToolResult` from plain text). Once `speaker_filter` is resolved to a single canonical name (via `resolveSpeaker`/`getSpeakersMatchingFilter`), `ask_church` (search branch) and `search_teachings` pass it straight into `hybridSearchChunks(query, { limit, speaker })` — the same hybrid (FTS5 + semantic vectors, RRF-fused) path the chat uses — so the speaker narrows both retrievers before the row limit is applied, instead of fetching a fixed-size sample and discarding non-matching rows afterward. The tools stay read-only (retrieval only reads).

### `frontend/` — React + Vite SPA
The entire member- and admin-facing UI is a single-page React app (TypeScript + Tailwind, mobile-responsive) built by Vite. The backend no longer renders HTML — it exposes JSON/SSE APIs under `/api/*` (plus the PDF download) and serves the built SPA. Key files:
- `frontend/src/App.tsx` — `react-router-dom` routes: `/` (chat), `/transcripts`, `/transcripts/:videoId`, `/admin`, `/admin/books`, `/admin/live`, `/lyrical-theology`, and a 404
- `frontend/src/api/client.ts` — typed fetch wrappers + the chat SSE reader (`streamChat`, an async generator yielding `delta`/`context`/`done`/`error` frames); `frontend/src/api/types.ts` mirrors the backend response shapes
- `frontend/src/pages/ChatPage.tsx` — message thread, streaming assistant bubbles (markdown via `marked`, sanitized with `dompurify` before rendering), collapsible "Sources", auto-growing input
- `frontend/src/pages/TranscriptsPage.tsx` — NL search box + structured filters (month/year/theme/speaker), responsive results table
- `frontend/src/pages/TranscriptViewPage.tsx` — single transcript, timestamped segments or paragraph fallback, Download PDF link
- `frontend/src/pages/AdminPage.tsx` — secret-gated stats + recent jobs, "Sync Now", 30 s auto-refresh, and a link to the Generate-Book page
- `frontend/src/pages/BookGenPage.tsx` — the Generate-Book page (`/admin/books`): topic form (`POST /api/admin/book-gen`) + a books table with a live progress column (`chaptersGenerated / chapterCount`) and Download-PDF links, polling every 5 s
- `frontend/src/pages/LiveStatusPage.tsx` — phase stepper (Download → Transcribe → Chunk → Embed), queue + recent tables, polls every 2 s
- `frontend/src/pages/DbBrowserPage.tsx` — secret-gated paginated table explorer (BLOBs shown as `[blob: NB]`)
- `frontend/src/components/HamburgerIcon.tsx` — shared mobile-nav icon (used by `TopBar`, `ChatPage`, `TranscriptViewPage`)
- `frontend/src/lib/useInterval.ts` — shared `useInterval(callback, ms, enabled?, immediate?)` hook wrapping the repeated poll-on-an-interval pattern used by `AdminPage`, `LiveStatusPage`, and `DbBrowserPage`'s auto-refresh toggle
- The admin secret lives in `sessionStorage` (`frontend/src/lib/useAdminSecret.ts`) and is sent as `X-Admin-Secret`

In dev, the Vite dev server (`:5173`) serves the SPA and proxies `/api`, `/assets`, `/health`, `/mcp`, and `/transcripts/*/download` to the Hono server (`:3000`). In production, `yarn build:web` emits the SPA to `public/app/` and Hono serves it.

The app is an installable **PWA**: `vite-plugin-pwa` generates `sw.js` + `manifest.webmanifest` (served from `public/app` by the catch-all). The service worker precaches the app shell and runtime-caches only public read-only data (`/api/transcripts/*`, `/api/themes`, `/assets/*`); the live chat SSE (`/api/chat`) and secret-gated `/api/admin/*` and `/api/db/*` routes are deliberately network-only. Icons live in `public/assets/` (`pwa-192x192.png`, `pwa-512x512.png`, `maskable-512x512.png`).

### `src/web/transcriptPdf.ts`
`generateTranscriptPdf(sermon, transcript)` renders a transcript to a PDF `Buffer` with `pdfkit` (pure JS — no headless browser; sub-second even for a 2-hour sermon). `transcriptPdfFilename(sermon)` builds the `theme__title__month-year.pdf` download name (theme falls back to `sermon`).

### `src/book/generator.ts`
`generateBook({ bookId, topic }, anthropic, ctx)` drafts a book from already-ingested sermon material as a background job. Phases: **retrieving** (the complete topic corpus via `searchSermonsByTopic` → `getSermonsByThemeName` → `findSermonsByTitle`, plus each sermon's chunks), **outlining** (a forced `emit_outline` tool call → title + ordered chapters, each pinned to sermon ids; the count is right-sized to the available material, capped at 12), **drafting** (one Claude call per chapter, grounded only in the relevant chunk text, with inline citations), **rendering** (mark the book `done`). After outlining it records `chapter_count` (`setBookChapterCount`) and then persists each chapter as it is drafted (`addBookChapter`) — not batched at the end — so the book page shows live `N / M` progress. The model is `BOOK_MODEL ?? CLAUDE_MODEL`; all calls go through `withRetry`. Returns a structured `{ status, message }` the queue maps to the job's terminal state, and marks the book row `failed` on any error (including an empty corpus). Each chapter draft is given **progressive context**: the full chapter plan plus a recap of the already-written chapters (their headings + foci — a compact running summary, not full prior prose) so chapters build on rather than repeat one another, at negligible token cost. The stable plan lives behind the `cache_control` breakpoint.

### `src/web/bookPdf.ts`
`generateBookPdf(book, chapters)` renders a generated book to a PDF `Buffer` with `pdfkit` (pure JS — no headless browser, like the transcript renderer): a title page, table of contents, each chapter, and a sources page listing the sermons the draft was grounded in. `bookPdfFilename(book)` builds the `book__title__month-year.pdf` download name. Served on demand at `GET /books/:id/download`, gated on `book.status === 'done'`.

### `src/web/transcriptQuery.ts`
`parseTranscriptQuery(text, anthropic)` uses the cheap `CHUNKING_MODEL` (wrapped in `withRetry`) to extract structured `{ date?, topic?, speaker? }` filters from a free-text request. `topic` is the subject the sermon should be *about* (e.g. "faith"), resolved by relevance — not a formal theme name. Returns `{}` on any parse failure so the route can fall back to a raw keyword search.

### `src/web/transcriptFormat.ts`
Pure formatting helpers shared by the transcripts table, view, and PDF: `formatSermonDate` ("4 July 2021"), `humanizeDatePrefix` ("February 2023"), `monthYearSlug` ("july-2021"), and `slugify`.

### `src/web/router.ts`
Hono app wiring all routes. The UI pages are client-side routes served by the SPA catch-all; this layer is JSON/SSE + static serving only.

**Chat**
- `POST /api/chat` — accepts `{ messages }` and runs an **agentic** Claude loop streamed over SSE. Claude is given three read-only tools (`CHAT_TOOLS`, dispatched by the async `runChatTool`): `search_sermon_excerpts` (**hybrid** FTS5 + semantic-vector chunk search via `hybridSearchChunks`, a reranked relevant sample), `list_sermons` (the **complete** roster for a date/topic/speaker filter, via `resolveTranscriptSermons` — so enumeration questions like "all sermons that month" don't miss any), and `find_sermon` (look up a named sermon's details, notably its YouTube link). Returns 404 if the library is empty. The system prompt is cached (`cache_control`) so the tools+system prefix is cheap to reuse across the loop's calls

**Transcripts** — public, read-only transcript delivery
- `GET /api/themes` — returns `{ id, name }[]` for the structured filter dropdown
- `GET /api/transcripts/search` — accepts `q` (natural-language, parsed via `parseTranscriptQuery`) **or** structured `month`/`year`/`theme`/`topic`/`speaker` params; returns `{ interpreted, sermons[] }`. Filters combine (base set by priority topic > theme > date > speaker, then the rest applied as predicates). `topic` is a **relevance** search over each sermon's Claude-derived section topics/summaries (`searchSermonsByTopic`), ranked by density. Registered before `/api/transcripts/:videoId` so "search" isn't read as a video id
- `GET /api/transcripts/:videoId` — returns `{ sermon, segments, transcript, hasTranscript }` (rendered client-side from `transcriptions.segments`, or paragraphs from the verbatim text)
- `GET /transcripts/:videoId/download` — streams an on-demand PDF (`application/pdf`, `Content-Disposition: attachment`); the SPA links to it directly
- `GET /books/:id/download` — streams a generated book's PDF on demand (404 if unknown, 409 until `status === 'done'`)

**Admin** — protected by `X-Admin-Secret` middleware on `/api/admin/*`
- `GET /api/admin/status` — returns `{ queueDepth, lastSyncAt, sermonCount }`
- `POST /api/admin/sync-api` — triggers a background sync from the sermon REST API, returns `{ ok: true }` (202)
- `GET /api/admin/jobs` — returns recent job list (up to 50)
- `GET /api/admin/status/data` — returns `{ queueDepth, jobs }`; queued jobs include their 1-based `position`
- `POST /api/admin/book-gen` — accepts `{ topic }`, creates the book row, enqueues a generation job, returns `{ jobId, bookId, downloadUrl }` (202)
- `GET /api/admin/books` — returns recent generated books (id, topic, title, status, `chapterCount`, `chaptersGenerated`, createdAt, downloadUrl)

**DB Browser** — protected by `X-Admin-Secret` middleware on `/api/db/*`
- `GET /api/db/:table` — returns paginated rows for `sermons`, `themes`, `transcriptions`, `chunks`, `jobs`, `missing_sermons`, `books`, or `book_chapters`; accepts `limit` and `offset` query params

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
4. `startScheduler(anthropic)` — syncs immediately, then registers a daily cron job at 06:00
5. `SIGTERM` / `SIGINT` handlers — wait for the active job to finish before exiting

---

## Data Flow: Web Chat

```
Member opens browser → GET / → SPA shell (public/app/index.html) → ChatPage

Member types question → POST /api/chat { messages: [...] }
    → 404 if countSermons() === 0
    → agentic loop (≤6 steps), each step = anthropic.messages.stream(...):
        tools offered on every step EXCEPT the last (forces a final answer)
        turn text is BUFFERED, not streamed — a turn that ends in a tool call
          is a "let me search…" preamble and is discarded
        finalMessage → stop_reason === 'tool_use'?
            await runChatTool() per tool_use block:
                search_sermon_excerpts → hybridSearchChunks(query)  FTS5 + vector, RRF-fused (top 15)
                list_sermons           → resolveTranscriptSermons  COMPLETE roster
                find_sermon            → findSermonsByTitle        named sermon + YouTube link
            { type: 'context', sources }          cumulative citations
            append tool_result blocks, continue
        else → this turn is the answer: flush its buffered text as { type: 'delta' }, end loop
          (the tool-forbidden final step streams its text live instead, since it can't be a preamble)
    → { type: 'done' }
    → answer is grounded only in tool results
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
    → hybridSearchChunks("What was...")  FTS5 + semantic vectors, RRF-fused
    → Anthropic API                      answer with citations
    → return answer text
```

---

## Chat

The chat UI lets church members ask questions about sermons in plain English and get answers
grounded in actual sermon content, with citations. It is **agentic**: instead of pre-running one
search and stuffing the results into the prompt, `POST /api/chat` (`src/web/router.ts`) hands
Claude a small set of read-only tools (`CHAT_TOOLS`, dispatched by `runChatTool()`) and lets it
choose the lookup per question. The motivating fix was enumeration: "what sermons were preached
that month?" needs the **complete** roster, which a top-N relevance search cannot guarantee.

### Tools

| Tool | Backed by | Use for |
|------|-----------|---------|
| `search_sermon_excerpts` | `hybridSearchChunks()` (`src/retrieval.ts`) — FTS5 + semantic vectors, RRF-fused, top `DEFAULT_RESULT_K` (15) | "What does X teach about Y" — a reranked relevant **sample** of excerpts with citations |
| `list_sermons` | `resolveTranscriptSermons()` (date / topic / speaker) | "List/count sermons in month X / by speaker / about topic" — the **complete** matching roster |
| `find_sermon` | `findSermonsByTitle()` (title `LIKE`, optional speaker/date) | "What's the YouTube link for the sermon on X" — the named sermon's details including its **YouTube link** (`webpage_url`) |

**Enumeration vs. excerpt search is enforced in code, not just prompt wording**: `list_sermons`
resolves a `{date, topic, speaker}` filter to the full sermon list (base set by priority topic >
theme > date > speaker, then remaining filters applied) — the same resolver the transcripts page
uses — so a month query hits `getSermonsByDate('2023-03')` and returns *every* sermon in March,
never a ranked sample. The system prompt reinforces this: use `list_sermons` (not excerpt search)
for any list/count, treat its result as the authoritative complete set, and never caveat with
"these are only the ones in the excerpts I was given."

`search_sermon_excerpts` runs the **hybrid retrieval** described above (`src/retrieval.ts` →
`hybridSearchChunks`): FTS5 lexical ranking fused via RRF with a semantic cosine ranking over the
same version-pinned embedder used at ingest, degrading to FTS-only if the embedder is still
warming up. This is what lets the chat handle paraphrases with no keyword overlap. `find_sermon`
matches the requested text against the sermon title (case-insensitive substring); if the matched
sermon has no `webpage_url` on file, the result says so plainly rather than inventing a URL.

All three tools' optional `speaker` filter resolves aliases the same way, via a shared
`matchesSpeaker()` helper (alias → canonical name via `resolveAliasToCanonical`, then a
case-insensitive substring match). `search_sermon_excerpts` pushes the resolved speaker into
**both** retrieval legs (the `searchChunks()` FTS SQL and the `getChunkEmbeddings()` vector scan)
rather than filtering results in JS afterward, so a speaker filter narrows the ranked set instead
of shrinking a fixed-size sample.

### Agentic loop & streaming

The loop is capped at `MAX_STEPS = 6` (`step < MAX_STEPS`). Each step opens an
`anthropic.messages.stream(...)` call with the tools attached — except the **last** permitted
step, which withholds the tools entirely (the SDK predates `tool_choice: 'none'`), forcing the
model to synthesise a final answer from whatever it already has rather than dangling on another
tool call.

- **Only the answer turn's text reaches the user.** A turn that ends in a tool call usually opens
  with a "let me search…" preamble; that text is buffered and discarded, never streamed. Only a
  turn that ends *without* a tool call is the answer, and only its text is surfaced — this avoided
  the earlier failure mode where every turn's text streamed and the UI showed a pile of preambles
  (or, if the loop ran out of steps mid-search, a preamble with no answer at all).
- After each turn, if `stop_reason !== 'tool_use'`, the buffered text is flushed as `delta` event(s)
  and the loop ends. Otherwise each `tool_use` block runs through `runChatTool()`, citations
  accumulate and emit as a `context` event, `tool_result` blocks are appended, and the loop
  continues. The forced-final last step streams its text live instead of buffering it, since it
  cannot be a preamble.
- **Sources stream as `context` events *after* tools run**, not before the answer — the frontend's
  `applySources()` attaches or refreshes the sources `<details>` on the existing bubble whenever a
  `context` event lands, even if the answer bubble already exists.

**Prompt caching:** a single `cache_control` breakpoint sits on the system prompt, so the
tools+system prefix — byte-identical across every call in the loop and across turns — is read at
~0.1× input cost on follow-up calls instead of repaying full price each time. Do not interpolate
per-request values into that system prompt, or the cache breaks.

SSE event types emitted by the backend:

| Event | When | Payload |
|-------|------|---------|
| `context` | After a tool runs (cumulative sources so far) | `{ type: 'context', sources: [{title, date, timestamp?}] }` |
| `delta` | The answer turn's text (pre-tool preambles suppressed) | `{ type: 'delta', text: '...' }` |
| `done` | When the loop ends | `{ type: 'done' }` |
| `error` | On exception | `{ type: 'error', message: '...' }` |

Claude is called with `CLAUDE_MODEL` (default `claude-sonnet-4-6`), `max_tokens: 3072` (headroom
for a full `list_sermons` roster), and the full conversation history — there is no server-side
session; each turn re-runs the agentic loop and re-queries the DB live, so answers always reflect
the current library. The system prompt also instructs Claude to respond warmly to greetings and
small talk without citing sermon content, avoiding an unhelpful citation of a random sermon on
"hello". Conversation history is mirrored client-side to `localStorage` (`ConversationsContext`,
key `kerygma_convos`) so conversations survive refreshes; transient `busy`/`streaming` flags are
sanitised on load.

### Limits and defaults

| Parameter | Value | Where set |
|-----------|-------|-----------|
| Excerpts per `search_sermon_excerpts` call | 15 (`DEFAULT_RESULT_K`) | `src/retrieval.ts` |
| Candidates pulled per retrieval leg (FTS + vector) | 50 (`CANDIDATE_K`) | `src/retrieval.ts` |
| RRF fusion constant `k` | 60 (`RRF_K`) | `src/retrieval.ts` |
| Sermons per `list_sermons` call | up to `MAX_TRANSCRIPT_RESULTS` (100) | `router.ts` → `resolveTranscriptSermons` |
| Sermons per `find_sermon` call | up to 10 | `router.ts` → `findSermonsByTitle(title, 10)` |
| Max agentic loop steps per turn | 6 | `router.ts` → `MAX_STEPS` |
| Max tokens per Claude turn | 3072 | `router.ts` |
| Claude model | `claude-sonnet-4-6` (overridable) | `config.ts` → `CLAUDE_MODEL` |

Note: the MCP `search_teachings` tool retrieves up to 20 chunks (not 15) via the same
`hybridSearchChunks` path, since it groups results by sermon and presents them structured rather
than as a synthesised narrative.

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
    embedding       BLOB                -- Float32[384], L2-normalised; queried by hybrid retrieval (cosine)
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

-- Generated book drafts (one row per book); chapters in a separate table
CREATE TABLE books (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic         TEXT NOT NULL,
    title         TEXT,                              -- model-chosen, set during outlining
    status        TEXT NOT NULL DEFAULT 'generating', -- generating | done | failed
    sources       TEXT,                              -- JSON BookSource[] for the PDF sources page
    chapter_count INTEGER,                           -- planned chapters, set after outlining (for progress)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chapters of a book, in order
CREATE TABLE book_chapters (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    idx     INTEGER NOT NULL,
    heading TEXT NOT NULL,
    body    TEXT NOT NULL
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
