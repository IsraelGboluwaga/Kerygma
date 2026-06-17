# @kerygma/sdk

A small, dependency-free TypeScript client for the [Kerygma](../../README.md)
sermon knowledge base HTTP API. It wraps the public `/api/*` JSON + SSE
endpoints (chat, transcripts, themes) and the secret-gated admin/db routes, with
types that mirror the backend contract in `src/web/router.ts`.

Works in Node 18+ and modern browsers — it uses the global `fetch` and Web
Streams. No runtime dependencies.

## Install

```bash
yarn add @kerygma/sdk
```

## Usage

```ts
import { KerygmaClient } from '@kerygma/sdk'

const kerygma = new KerygmaClient({ baseUrl: 'https://kerygma.example.com' })

// Streaming agentic chat (SSE) — yields delta / context / done / error frames
for await (const ev of kerygma.streamChat([{ role: 'user', content: 'What was taught about grace?' }])) {
  if (ev.type === 'delta') process.stdout.write(ev.text)
  else if (ev.type === 'context') console.log('\nSources:', ev.sources)
}

// Or drain the stream and get the whole answer + sources at once
const { answer, sources } = await kerygma.ask([
  { role: 'user', content: 'Summarise the sermons on faith from March 2024.' },
])

// Transcripts
const results = await kerygma.searchTranscripts({ topic: 'faith', year: 2024 })
const view = await kerygma.getTranscript(results.sermons[0].videoId)
const pdfUrl = kerygma.transcriptDownloadUrl(view.sermon.videoId)

// Themes
const themes = await kerygma.listThemes()
```

### Admin endpoints

Admin/db methods need the admin secret. Pass it once when constructing the
client; calling an admin method without it throws.

```ts
const admin = new KerygmaClient({
  baseUrl: 'https://kerygma.example.com',
  adminSecret: process.env.ADMIN_SECRET,
})

await admin.getAdminStatus()       // { queueDepth, lastSyncAt, sermonCount }
await admin.getStatusData()        // { queueDepth, jobs }
await admin.syncApi()              // trigger a background API sync
await admin.getDbTable('sermons', 50, 0)
```

### Custom `fetch`

On runtimes without a global `fetch`, inject one:

```ts
import fetch from 'node-fetch'
const kerygma = new KerygmaClient({ baseUrl, fetch: fetch as unknown as typeof globalThis.fetch })
```

## API surface

| Method | Endpoint | Auth |
|---|---|---|
| `streamChat(messages, signal?)` | `POST /api/chat` (SSE) | public |
| `ask(messages, signal?)` | `POST /api/chat` (drained) | public |
| `searchTranscripts(params \| qs)` | `GET /api/transcripts/search` | public |
| `getTranscript(videoId)` | `GET /api/transcripts/:videoId` | public |
| `transcriptDownloadUrl(videoId)` | `GET /transcripts/:videoId/download` | public |
| `listThemes()` | `GET /api/themes` | public |
| `getAdminStatus()` | `GET /api/admin/status` | `X-Admin-Secret` |
| `getAdminJobs()` | `GET /api/admin/jobs` | `X-Admin-Secret` |
| `getStatusData()` | `GET /api/admin/status/data` | `X-Admin-Secret` |
| `syncApi()` | `POST /api/admin/sync-api` | `X-Admin-Secret` |
| `getDbTable(table, limit?, offset?)` | `GET /api/db/:table` | `X-Admin-Secret` |

Non-2xx responses throw `ApiError` (with `.status`); chat `error` frames throw
`ApiError` from `ask()`.

## Keeping the contract in sync

The response types in `src/types.ts` are a hand-maintained copy of
`frontend/src/api/types.ts` and `src/web/router.ts`. When a route's response
shape changes on the backend, update all three.

## Build

```bash
yarn build:sdk        # from repo root — tsc → packages/sdk/dist
yarn typecheck:sdk
```
