# Kerygma

> A church sermon knowledge base — admins ingest MP3 sermons via a web UI, church members query via MCP.

**Kerygma** (κήρυγμα) — Greek for "proclamation" or "preaching of the gospel"

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

Kerygma lets church administrators paste an MP3 URL into a web form. The server downloads the audio, transcribes it with Whisper, divides it into semantic sections using Claude, generates embeddings, and saves everything to SQLite with FTS5 full-text search. Church members then query the knowledge base through any MCP-compatible client (e.g. Claude Desktop).

### Features

- **React + Vite SPA** — chat, transcripts, admin, live status, and DB browser as one mobile-responsive single-page app (Tailwind), installable as a **PWA** with an offline app shell
- **Web admin UI** — paste an MP3 URL, submit, watch the job complete
- **Whisper transcription** — speech-to-text via the OpenAI Whisper API (`whisper-1`)
- **Claude chunking** — sermon divided into named sections with timestamps, topics, and summaries
- **Hybrid retrieval** — chat excerpt search fuses FTS5 keyword ranking with semantic vector similarity (Reciprocal Rank Fusion), so answers scale with the library and handle paraphrased questions
- **Transcripts page** — `/transcripts` finds sermons by date, theme, or keyword (natural-language or structured filters) and delivers viewable transcripts + on-demand PDF download
- **Embeddings** — 384-dim per-chunk vectors (`all-MiniLM-L6-v2`) powering the semantic half of hybrid retrieval
- **MCP server** — 4 read-only tools for church members to query via Claude Desktop
- **In-process job queue** — sequential ingestion, non-blocking admin UI
- **Duplicate detection** — same URL ingested twice is a no-op
- **Duration limit** — configurable cap to reject overly long files
- **Speaker disambiguation** — "Apostle" with multiple matches prompts a clarifying list
- **Nearest-date fallback** — suggests the closest sermon when an exact date has no results
- **Docker-first** — multi-stage image bundles ffmpeg; no host toolchain needed
- **Railway/Render ready** — single process, persistent SQLite volume

---

## Architecture

```
Browser → React SPA (public/app, client-side routes: /, /transcripts, /admin, …)
    ▼
Hono HTTP Server (:3000)
    ├── POST /api/chat                    → Agentic chat (SSE stream)
    ├── GET  /api/themes                  → Theme list for filters (JSON)
    ├── GET  /api/transcripts/search      → Date/theme/keyword results (JSON)
    ├── GET  /api/transcripts/:id         → Viewable transcript (JSON)
    ├── GET  /transcripts/:id/download    → Transcript PDF
    ├── GET  /api/admin/status            → Stats snapshot          (X-Admin-Secret)
    ├── POST /api/admin/sync-api          → Trigger background sync (X-Admin-Secret)
    ├── GET  /api/admin/jobs              → Recent job statuses     (X-Admin-Secret)
    ├── GET  /api/admin/status/data       → Live queue + phase      (X-Admin-Secret)
    ├── GET  /api/db/:table               → Paginated table rows    (X-Admin-Secret)
    ├── GET  /health                      → { ok: true }
    └── GET  *                            → SPA static files / index.html fallback
         │
    In-process job queue (sequential)
         │
    Ingestion Pipeline
         ├── Download MP3 → temp file
         ├── OpenAI Whisper API → transcript segments
         ├── Claude → semantic chunks
         ├── @xenova/transformers → embedding per chunk
         └── better-sqlite3 → sermons + chunks

MCP Client (Claude Desktop)
    │  HTTP POST /mcp
    ▼
McpServer — 4 read-only tools
```

---

## Project Structure

```
kerygma/
├── src/
│   ├── config.ts                  # Zod env validation; crashes on startup if required vars missing
│   ├── logger.ts                  # Winston logger (colourised in dev, plain in production)
│   ├── retry.ts                   # withRetry() — exponential backoff for Anthropic API calls
│   ├── utils.ts                   # errMsg() — safe error-to-string extraction
│   ├── queue.ts                   # In-process FIFO job queue (persisted to jobs table)
│   ├── main.ts                    # Entry: initDb → loadEmbedder → serve
│   ├── db/
│   │   ├── schema.ts              # DDL + FTS5 triggers + migration shims
│   │   ├── connection.ts          # better-sqlite3 singleton
│   │   └── queries.ts             # Typed query functions
│   ├── ingestion/
│   │   ├── downloader.ts          # HTTP MP3 → temp file
│   │   ├── transcriber.ts         # OpenAI Whisper API → TranscriptSegment[]
│   │   ├── chunker.ts             # Claude chunking + validateChunks + formatTimestamp
│   │   ├── embedder.ts            # @xenova/transformers singleton (all-MiniLM-L6-v2)
│   │   └── pipeline.ts            # Orchestrates full ingest (with retry resume)
│   ├── mcp/
│   │   └── server.ts              # 4 MCP tool registrations
│   └── web/
│       ├── router.ts              # Hono app — /api/* JSON+SSE, PDF download, SPA serving
│       ├── transcriptPdf.ts       # pdfkit PDF generator + filename builder
│       ├── transcriptQuery.ts     # Claude NL → { date, theme, speaker } filter parser
│       └── transcriptFormat.ts    # Shared date/slug formatting helpers
├── frontend/                      # React + Vite SPA (TypeScript + Tailwind)
│   ├── vite.config.ts             # Build → ../public/app; dev proxy → :3000
│   ├── tailwind.config.ts         # Design tokens (dark theme, red accent)
│   └── src/
│       ├── App.tsx                # react-router routes for all pages
│       ├── api/                   # Typed fetch client + SSE chat reader + response types
│       ├── components/            # Shared TopBar, Badge
│       ├── lib/                   # Formatting + useAdminSecret (sessionStorage)
│       └── pages/                 # Chat, Transcripts, TranscriptView, Admin, LiveStatus, DbBrowser
├── public/
│   ├── assets/                    # Logos/icons served at /assets
│   └── app/                       # Vite build output (gitignored, created by yarn build:web)
├── tests/
│   ├── setup.ts                   # Env vars for test context
│   ├── db.test.ts                 # Storage layer (26 tests)
│   ├── chunker.test.ts            # Pure unit tests (12 tests)
│   ├── ingestion.test.ts          # Pipeline tests, mocked (12 tests)
│   └── queue.test.ts              # Queue behaviour (8 tests)
├── data/
│   └── sermons.db                 # SQLite database (created at runtime, gitignored)
├── dev-docs/
│   ├── ARCHITECTURE.md            # Detailed technical architecture and data flows
│   └── CHAT.md                    # Chat feature deep-dive
├── Dockerfile
├── .dockerignore
├── mcpConnect.md                  # MCP connection guide (Claude Desktop + deployed)
├── package.json
├── tsconfig.json
├── railway.json
└── .env.example
```

---

## Installation

### Prerequisites

- Docker
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com/))
- OpenAI API key ([platform.openai.com](https://platform.openai.com/)) — used for Whisper transcription

Docker handles everything else: Node 20 and ffmpeg (used to compress audio over 25 MB before upload to the Whisper API). No host toolchain required.

### Docker (recommended)

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd kerygma
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   ADMIN_SECRET=your-secret-password
   SERMON_BASE_URL=https://sermons-api.example.com/sermons
   ```

3. **Build the image**
   ```bash
   docker build -t kerygma .
   ```

   Builds the TypeScript source and compiles native addons. No large model downloads — transcription is handled by the OpenAI Whisper API at runtime.

4. **Run**
   ```bash
   docker run -p 3000:3000 --env-file .env -v kerygma-data:/data kerygma
   ```

   The `-v kerygma-data:/data` flag creates a named volume so the SQLite database persists across container restarts. The server starts at `http://localhost:3000`.

---

### Local Development (without Docker)

Requires: Node 20+, Yarn, ffmpeg (`brew install ffmpeg` on macOS; `apt-get install ffmpeg` on Linux).

```bash
yarn install
cp .env.example .env          # fill in all required variables
yarn dev
```

The server starts at `http://localhost:3000`.

---

## Usage

### For Church Administrators

Open `http://localhost:3000/admin` in a browser.

Fill in the form:
- **Download URL** — direct link to the audio file (MP3)
- **Webpage URL** *(optional)* — the sermon page on the church website
- **Title** — sermon title
- **Theme** *(optional)* — sermon theme; normalised into a `themes` table and linked by id
- **Speaker** — preacher's name (required)
- **Date** — sermon date
- **Tags** *(optional)* — comma-separated keywords

Click **Ingest Sermon**. The form polls every 3 seconds and shows the job status until it finishes (`done`) or fails (`failed`). Multiple sermons can be queued — they process one at a time.

For deeper visibility, open the **Live status →** link (or visit `/admin/status`). It auto-refreshes every 2 seconds and shows the running job's current phase (Download → Transcribe → Chunk → Embed) plus each queued job's position in line — all from structured job state, so it adds no log noise.

If a job fails after transcription, re-submitting the same URL will resume from the chunking step — the transcription is preserved in the database, so the download and Whisper step are not repeated.

The `X-Admin-Secret` header is sent automatically using the password you type into the form.

---

### For Church Members

Open `http://localhost:3000/` to ask questions in the chat UI, or `http://localhost:3000/transcripts` to find and read sermon transcripts. The transcripts page accepts a natural-language request ("sermons in February 2023", "all sermons on faith", "the message on the 4th of July 2021") or structured month/year/theme/speaker filters, lists matches in a mobile-responsive table, and offers each transcript as a viewable page and an on-demand PDF download.

Connect via any MCP-compatible client. See `mcpConnect.md` for full setup instructions.

For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kerygma": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For a deployed instance, replace `localhost:3000` with your Railway/Render URL.

#### Available Tools

**`list_sermons(limit?)`**
List indexed sermons, most recent first.

**`ask_church(question, date_filter?, speaker_filter?)`**
Ask a question about church teachings. Claude searches relevant chunks and synthesises an answer with citations and timestamps. Optionally narrow by date and/or speaker.
```
What does the church teach about tithing?
What did Apostle Emmanuel say about faith in March 2024?
```

**`summarise_sermon(date, speaker?)`**
Get a full Claude-written summary of what was preached on a given date. If no exact match is found, the nearest available sermon is suggested. Speaker disambiguation prompts a list if multiple speakers match.
```
Summarise what was preached on 2024-03-10
What did Apostle teach on March 12, 2024?
```

**`search_teachings(topic, speaker_filter?)`**
Search for a topic across all sermons, optionally filtered by speaker.
```
Find all teachings on prayer
What has Apostle Emmanuel Iren said about healing?
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key (used for Whisper transcription) |
| `ADMIN_SECRET` | Yes | — | Password for the admin UI |
| `SERMON_BASE_URL` | Yes | — | Full sermon listing endpoint, e.g. `https://sermons-api.example.com/sermons` (the `page`/`perPage` query string is appended directly) |
| `AUDIO_BASE_URL` | Yes | — | Base URL prepended to relative audio paths returned by the sermon API (a trailing slash is normalised) |
| `MINISTRY_NAME` | No | `the church` | Ministry name shown in the UI and AI prompts |
| `DB_PATH` | No | `./data/sermons.db` | SQLite database path |
| `PORT` | No | `3000` | HTTP server port |
| `MAX_AUDIO_DURATION_SECONDS` | No | `7200` | Duration cap (seconds) |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model for chat synthesis |
| `CHUNKING_MODEL` | No | `claude-haiku-4-5-20251001` | Claude model for semantic chunking |
| `BOOK_MODEL` | No | `CLAUDE_MODEL` | Claude model used to draft book chapters (falls back to `CLAUDE_MODEL`) |
| `R2_ACCOUNT_ID` | No | — | Cloudflare account ID for Litestream replication and dated archive exports |
| `R2_ACCESS_KEY_ID` | No | — | R2 access key ID for Litestream replication and dated archive exports |
| `R2_SECRET_ACCESS_KEY` | No | — | R2 secret access key for Litestream replication and dated archive exports |
| `R2_BUCKET` | No | — | R2 bucket name; replication and archive exports are skipped if any R2 var is unset |

---

## Database Schema

```sql
themes         (id, theme_id, name, slug, created_at)
sermons        (id, video_id, title, date, download_url, webpage_url, speaker, excerpt, theme_id,
                description, duration, tags, ingestion_status, transcription, created_at)
transcriptions (id, sermon_id, transcript, segments, created_at)
chunks         (id, sermon_id, section_name, content, timestamp_start, timestamp_end, topics, summary, embedding)
chunks_fts     — FTS5 virtual table, auto-synced via 3 triggers
jobs           (id, title, download_url, payload, status, phase, message, error, created_at, started_at, completed_at)
missing_sermons (id, video_id, title, date, download_url, webpage_url, speaker, theme, kind, reason, created_at, updated_at)
books          (id, topic, title, status, sources, chapter_count, created_at)
book_chapters  (id, book_id, idx, heading, body)
```

`video_id` comes from the sermon API's `_id` field, or falls back to `SHA256(downloadUrl).slice(0, 16)` for manually-ingested URLs.
`themes` is keyed on the upstream `theme_id` (the API's theme `_id`) so a sermon's theme link survives an upstream name change; `sermons.theme_id` is a foreign key to `themes.id`.
`excerpt` stores the short summary from the sermon listing API (kept on `sermons` for fast list/card rendering).
`ingestion_status` is `'transcribed'` while chunking is in progress, `'done'` once complete.
`transcriptions` stores the full plain-text transcript and JSON segment array separately from `sermons` to keep sermon queries fast.
`missing_sermons` holds sermons that failed to ingest, keyed by `video_id` so retries upsert and a successful ingest clears the row. `kind` classifies the failure (`no_audio` — `download_url` was just `AUDIO_BASE_URL` with no path; `too_long`; `timeout` — transient, retried on next sync; `error`). Server-restart failures are not recorded. Browse it under `/lyrical-theology`.
`books` holds generated book drafts (`status`: `generating` → `done`/`failed`; `sources` is a JSON array of the sermons the draft was grounded in); `book_chapters` holds each book's chapters in order. See **Book generation** below.

---

## Book generation

From the admin page, click **Generate a Book** (the `/admin/books` page) and enter a topic —
e.g. "hope". The app assembles a book **entirely from the ministry's own sermons**, as a
background job:

1. **retrieving** — the complete roster of sermons *about* the topic is resolved (the same
   relevance-density search the chat uses), and their chunks are pulled as grounding material.
2. **outlining** — Claude designs a title and an ordered set of chapters, each tied to specific
   sermon material (forced `emit_outline` tool call). The **number of chapters is right-sized to
   the available sermon material** (a thin topic yields fewer; capped at 12).
3. **drafting** — each chapter is written grounded in the relevant sermon excerpts, with inline
   citations — never from general knowledge. Each chapter also gets the full plan and a recap of
   the earlier chapters, so it **builds on them rather than repeating**. Chapters are saved as
   they're written, so the book page shows live **N / M chapters** progress.
4. **rendering** — the PDF is generated **on demand** at `GET /books/:id/download` (pdfkit, like
   transcripts; Markdown lives in `books`/`book_chapters`).

The job also appears in the admin jobs dashboard with its live phase. The model is `BOOK_MODEL`
(defaults to `CLAUDE_MODEL`). Endpoints: `POST /api/admin/book-gen` (`{ topic }`, admin-only),
`GET /api/admin/books` (admin-only, includes progress), `GET /books/:id/download` (public, once
the book is `done`).

---

## Development

```bash
yarn dev            # run backend (tsx watch) + Vite dev server together (concurrently)
yarn dev:server     # backend only (tsx watch src/main.ts)
yarn dev:web        # Vite dev server only (:5173, proxies /api to :3000)
yarn build          # build the SPA (→ public/app) and the backend (→ dist)
yarn build:web      # Vite build only
yarn build:server   # esbuild backend only (fast transpile, no type check)
yarn typecheck      # tsc --noEmit (backend)
yarn typecheck:web  # tsc --noEmit (frontend)
yarn start          # node dist/main.js
yarn test           # vitest run
yarn test:watch     # vitest in watch mode
yarn test:coverage  # vitest with v8 coverage report
```

`yarn dev` runs the frontend on `http://localhost:5173` (which proxies API calls to the backend on `:3000`) — open that URL while developing. For the backend you need ffmpeg installed on your machine (`brew install ffmpeg`) — it compresses audio over 25 MB before upload to the Whisper API. The React frontend lives in `frontend/` as a yarn workspace, so a single `yarn install` at the repo root installs everything.

---

## Deployment (Railway)

Railway uses the `Dockerfile` for builds.

1. Create a new Railway project from this repo
2. Add a Volume mounted at `/data`
3. Set environment variables (see Configuration above), with `DB_PATH=/data/sermons.db`
4. Push to the connected branch — Railway builds the Docker image automatically

Transcription runs on the OpenAI Whisper API, so nothing is downloaded at build time for it. The embedding model (~90MB) is downloaded on first cold start and cached in `$HOME/.cache`.

### Database backups

When all four R2 variables are configured, Litestream continuously replicates SQLite to the stable `sermons/` prefix in R2. The object names under `sermons/generations/...` are Litestream internals and are not meant to be human-readable.

For visual confidence and manual downloads, the app also writes dated plain SQLite exports:

```text
archives/sermons-2026-06-08T22-15-00Z.db
```

These archives are created once on startup and then daily at 03:15 UTC. Litestream remains the primary recovery path for data loss because it restores from snapshots plus WAL files to the latest replicated transaction.

### Layer caching on rebuilds

Docker layer order is optimised so code-only changes are fast:

```
apt-get install build-essential...  ← cached forever
COPY package.json yarn.lock + frontend/package.json  ← workspace manifests
RUN yarn install                    ← cached until a manifest changes (compiles better-sqlite3)
COPY . .                            ← invalidated on every code change
RUN yarn build                      ← Vite SPA + esbuild backend (~seconds)
```

---

## Troubleshooting

**`ADMIN_SECRET: Required` on startup**
Set `ADMIN_SECRET` in your `.env` file.

**Admin UI returns 401**
The password entered in the form doesn't match `ADMIN_SECRET`.

**Job stuck in `running` state**
Whisper or the Anthropic API call may have hung. Restart the server — the queue resets on startup.

**`database is locked`**
Another process has the SQLite file open. SQLite WAL mode is enabled so this should be rare; check for stray processes.

**`No sermons found for date: ...` — but a nearby date is suggested**
No sermon was ingested for that exact date. The app will suggest the closest available date — try again with that.

---

## Security

- The admin UI requires `X-Admin-Secret` on every request — keep `ADMIN_SECRET` strong
- MCP tools are read-only; members cannot modify the database
- No authentication on the MCP endpoint — deploy behind a trusted network or add a reverse-proxy auth layer if needed

---

**Built with:** TypeScript, Hono, better-sqlite3, OpenAI Whisper API, @xenova/transformers, Claude AI, @modelcontextprotocol/sdk

**Kerygma** (κήρυγμα) — making the preached word searchable and accessible to your congregation.
