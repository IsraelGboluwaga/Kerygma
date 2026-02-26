# Kerygma

> A church sermon knowledge base — admins ingest MP3 sermons via a web UI, church members query via MCP.

**Kerygma** (κήρυγμα) — Greek for "proclamation" or "preaching of the gospel"

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

Kerygma lets church administrators paste an MP3 URL into a web form. The server downloads the audio, transcribes it with Whisper, divides it into semantic sections using Claude, generates embeddings, and saves everything to SQLite with FTS5 full-text search. Church members then query the knowledge base through any MCP-compatible client (e.g. Claude Desktop).

### Features

- **Web admin UI** — paste an MP3 URL, submit, watch the job complete
- **Whisper transcription** — local speech-to-text via nodejs-whisper
- **Claude chunking** — sermon divided into named sections with timestamps, topics, and summaries
- **FTS5 full-text search** — fast keyword search across all indexed content
- **Embeddings** — 384-dim vectors stored per chunk for future vector search
- **MCP server** — 4 read-only tools for church members to query via Claude Desktop
- **In-process job queue** — sequential ingestion, non-blocking admin UI
- **Duplicate detection** — same URL ingested twice is a no-op
- **Duration limit** — configurable cap to reject overly long files
- **Speaker disambiguation** — "Apostle" with multiple matches prompts a clarifying list
- **Nearest-date fallback** — suggests the closest sermon when an exact date has no results
- **Docker-first** — multi-stage image bundles whisper.cpp, ffmpeg, and the model; no host toolchain needed
- **Railway/Render ready** — single process, persistent SQLite volume

---

## Architecture

```
Browser (Admin)
    │  POST /admin/ingest
    ▼
Hono HTTP Server (:3000)
    ├── GET  /admin          → Admin form (password-gated)
    ├── POST /admin/ingest   → Enqueue job → 202 + jobId
    ├── GET  /admin/jobs     → Recent job statuses
    ├── GET  /admin/jobs/:id → Poll single job
    └── GET  /health         → { ok: true }
         │
    In-process job queue (sequential)
         │
    Ingestion Pipeline
         ├── Download MP3 → temp file
         ├── nodejs-whisper → transcript segments
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
│   ├── config.ts                  # Zod env validation
│   ├── queue.ts                   # In-process FIFO job queue
│   ├── main.ts                    # Entry: initDb → loadEmbedder → serve
│   ├── db/
│   │   ├── schema.ts              # DDL + FTS5 triggers + migration shims
│   │   ├── connection.ts          # better-sqlite3 singleton
│   │   └── queries.ts             # Typed query functions
│   ├── ingestion/
│   │   ├── downloader.ts          # HTTP MP3 → temp file
│   │   ├── transcriber.ts         # nodejs-whisper → TranscriptSegment[]
│   │   ├── chunker.ts             # Claude chunking + validateChunks
│   │   ├── embedder.ts            # @xenova/transformers singleton
│   │   └── pipeline.ts            # Orchestrates full ingest (with retry resume)
│   ├── mcp/
│   │   └── server.ts              # 4 MCP tool registrations
│   └── web/
│       ├── router.ts              # Hono app
│       ├── adminHtml.ts           # Admin form HTML
│       └── chatHtml.ts            # Streaming chat UI
├── tests/
│   ├── setup.ts                   # Env vars for test context
│   ├── db.test.ts                 # Storage layer (26 tests)
│   ├── chunker.test.ts            # Pure unit tests (12 tests)
│   ├── ingestion.test.ts          # Pipeline tests, mocked (12 tests)
│   └── queue.test.ts              # Queue behaviour (8 tests)
├── data/
│   └── sermons.db                 # SQLite database (created at runtime)
├── Dockerfile
├── .dockerignore
├── ARCHITECTURE.md
├── mcpConnect.md
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

Docker handles everything else: Node 20, cmake, whisper.cpp compilation, ffmpeg, and the Whisper model download. No host toolchain required.

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
   ADMIN_SECRET=your-secret-password

   # Optional
   DB_PATH=/data/sermons.db
   PORT=3000
   MAX_AUDIO_DURATION_SECONDS=7200
   WHISPER_MODEL=base.en
   ```

3. **Build the image**
   ```bash
   docker build -t kerygma .
   ```

   This compiles whisper.cpp and downloads the Whisper model into the image. Takes a few minutes on first build; subsequent code-only rebuilds are fast due to layer caching.

4. **Run**
   ```bash
   docker run -p 3000:3000 --env-file .env -v kerygma-data:/data kerygma
   ```

   The `-v kerygma-data:/data` flag creates a named volume so the SQLite database persists across container restarts. The server starts at `http://localhost:3000`.

To use a larger Whisper model (e.g. `small.en`):
```bash
docker build --build-arg WHISPER_MODEL=small.en -t kerygma .
```

---

### Local Development (without Docker)

Requires: Node 20+, Yarn, cmake, ffmpeg (`brew install cmake ffmpeg` on macOS).

```bash
yarn install
npx nodejs-whisper download   # compiles whisper.cpp + downloads model (~142MB)
cp .env.example .env          # fill in ANTHROPIC_API_KEY + ADMIN_SECRET
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
- **Speaker** — preacher's name
- **Date** — sermon date
- **Tags** *(optional)* — comma-separated keywords

Click **Ingest Sermon**. The form polls every 3 seconds and shows the job status until it finishes (`done`) or fails (`failed`). Multiple sermons can be queued — they process one at a time.

If a job fails after transcription, re-submitting the same URL will resume from the chunking step — the transcription is preserved in the database, so the download and Whisper step are not repeated.

The `X-Admin-Secret` header is sent automatically using the password you type into the form.

---

### For Church Members

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
| `ADMIN_SECRET` | Yes | — | Password for the admin UI |
| `DB_PATH` | No | `./data/sermons.db` | SQLite database path |
| `PORT` | No | `3000` | HTTP server port |
| `MAX_AUDIO_DURATION_SECONDS` | No | `7200` | Duration cap (seconds) |
| `WHISPER_MODEL` | No | `base.en` | Whisper model name |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model for chunking and synthesis |

---

## Database Schema

```sql
sermons (id, video_id, title, date, download_url, webpage_url, speaker, duration, tags,
         ingestion_status, transcription, created_at)
chunks  (id, sermon_id, section_name, content, timestamp_start, timestamp_end, topics, summary, embedding)
chunks_fts — FTS5 virtual table, auto-synced via 3 triggers
```

`video_id` is `SHA256(downloadUrl).slice(0, 16)` — duplicate detection is URL-based.
`ingestion_status` is `'transcribed'` while chunking is in progress, `'done'` once complete. Partial records enable retry resume without re-downloading.

---

## Development

```bash
yarn dev          # run with tsx (needs cmake + ffmpeg + whisper model on host)
yarn build        # tsc → dist/
yarn start        # node dist/main.js
yarn test         # vitest — 58 tests
yarn typecheck    # tsc --noEmit
```

For iterating on code without rebuilding the full Docker image, `yarn dev` is faster — but you need cmake and ffmpeg installed on your machine (`brew install cmake ffmpeg`) and the Whisper model compiled (`npx nodejs-whisper download`).

---

## Deployment (Railway)

Railway uses the `Dockerfile` for builds.

1. Create a new Railway project from this repo
2. Add a Volume mounted at `/data`
3. Set environment variables (see Configuration above), with `DB_PATH=/data/sermons.db`
4. Push to the connected branch — Railway builds the Docker image automatically

The Whisper model is downloaded during the Docker build step and baked into the image layer. The embedding model (~90MB) is downloaded on first cold start and cached in `$HOME/.cache`.

### Layer caching on rebuilds

Docker layer order is optimised so code-only changes are fast:

```
apt-get install cmake...    ← cached forever
COPY package.json yarn.lock ← cached until deps change
RUN yarn install            ← cached until yarn.lock changes (compiles whisper.cpp + sqlite)
RUN wget whisper model      ← cached until yarn.lock changes
COPY . .                    ← invalidated on every code change
RUN yarn build              ← only this re-runs for code changes (~seconds)
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

**Built with:** TypeScript, Hono, better-sqlite3, nodejs-whisper, @xenova/transformers, Claude AI, @modelcontextprotocol/sdk

**Kerygma** (κήρυγμα) — making the preached word searchable and accessible to your congregation.
