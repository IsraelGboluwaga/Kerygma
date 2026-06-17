# Connecting to and using the Kerygma SDK

`@kerygma/sdk` is a small, **dependency-free** TypeScript client for the Kerygma
sermon knowledge base HTTP API. It wraps the public `/api/*` JSON + SSE
endpoints (chat, transcripts, themes) and the secret-gated admin/db reads, with
types that mirror the backend contract in `src/web/router.ts`.

It runs anywhere there is a global `fetch` and Web Streams — **Node 18+** and all
modern browsers — and ships **zero runtime dependencies**.

> The package source lives in [`packages/sdk/`](../packages/sdk). This document
> is the connect-and-use guide; `packages/sdk/README.md` is the quick reference.

---

## Install

```bash
yarn add @kerygma/sdk
# or
npm install @kerygma/sdk
```

If you are consuming it from within this monorepo, it is already a workspace —
build it with `yarn build:sdk`.

---

## Connect

Create one `KerygmaClient` pointed at your Kerygma deployment's base URL. The
client is cheap to construct and safe to reuse across requests.

```ts
import { KerygmaClient } from '@kerygma/sdk'

const kerygma = new KerygmaClient({
  baseUrl: 'https://kerygma.example.com', // no trailing slash needed
})
```

### Constructor options

| Option | Type | Required | Purpose |
|---|---|---|---|
| `baseUrl` | `string` | **yes** | Root URL of the Kerygma server. A trailing slash is tolerated. |
| `adminSecret` | `string` | no | Sent as the `X-Admin-Secret` header on admin/db methods only. Required only if you call those methods. |
| `fetch` | `typeof fetch` | no | Custom `fetch` implementation. Defaults to the global `fetch`. Inject one for older runtimes or to add transport-level behaviour (see [Authentication](#authentication)). |

`baseUrl` is the only required option. If no global `fetch` exists and none is
injected, the constructor throws immediately with a clear message.

---

## Authentication

Kerygma's own API defines **one** secret: the **admin secret**, which protects
the `/api/admin/*` and `/api/db/*` routes. Everything else (chat, transcripts,
themes) is public.

Provide the admin secret once at construction; it is then sent as
`X-Admin-Secret` on every admin/db call:

```ts
const admin = new KerygmaClient({
  baseUrl: 'https://kerygma.example.com',
  adminSecret: process.env.KERYGMA_ADMIN_SECRET,
})

await admin.getAdminStatus()
```

Calling an admin/db method **without** an `adminSecret` configured throws a clear
error before any request is made. Public methods never send the secret.

> **Security:** treat the admin secret like a password. Use it only from trusted
> server-side code — never ship it to a browser bundle. For untrusted clients,
> expose only the public methods (no `adminSecret`).

### Adding your own auth (gateway / bearer / "client secret")

The SDK has no dedicated field for a *consumer's own* credentials (e.g. a bearer
token, an API-gateway key, or a reverse-proxy "client secret"). The supported
way to attach arbitrary headers is to **wrap `fetch`** — every request the client
makes goes through it:

```ts
const authedFetch: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${process.env.GATEWAY_TOKEN}`,
      'X-Client-Id': process.env.CLIENT_ID!,
    },
  })

const kerygma = new KerygmaClient({
  baseUrl: 'https://gateway.example.com/kerygma',
  fetch: authedFetch,
})
```

This injects your headers on **all** calls (including the chat SSE stream),
without the SDK needing to know about your auth scheme. See the
[FAQ](#faq--can-the-sdk-take-the-consumers-client-secret) for the nuance.

---

## Usage

### Chat (streaming)

`streamChat()` opens the agentic chat SSE stream and yields parsed event frames.
`context` (sources) can arrive before the answer text; `delta` frames stream the
answer token-by-token; the stream ends with `done` (or `error`).

```ts
import type { ChatMessage } from '@kerygma/sdk'

const messages: ChatMessage[] = [
  { role: 'user', content: 'What was taught about grace?' },
]

for await (const ev of kerygma.streamChat(messages)) {
  switch (ev.type) {
    case 'delta':
      process.stdout.write(ev.text)
      break
    case 'context':
      console.log('\nSources:', ev.sources)
      break
    case 'error':
      throw new Error(ev.message)
    case 'done':
      break
  }
}
```

Pass an `AbortSignal` as the second argument to cancel mid-stream:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 10_000)
for await (const ev of kerygma.streamChat(messages, controller.signal)) {
  // ...
}
```

### Chat (one-shot)

`ask()` drains the stream for you and returns the full answer plus accumulated
sources. It throws `ApiError` on an `error` frame.

```ts
const { answer, sources } = await kerygma.ask([
  { role: 'user', content: 'Summarise the sermons on faith from March 2024.' },
])

console.log(answer)
console.log(sources) // ChatSource[]: { title, date, timestamp? }
```

Multi-turn conversations are just a longer `messages` array (alternating
`user`/`assistant`):

```ts
const { answer } = await kerygma.ask([
  { role: 'user', content: 'What did the church teach about tithing?' },
  { role: 'assistant', content: answerSoFar },
  { role: 'user', content: 'And how does that relate to generosity?' },
])
```

### Transcripts

Search with a structured filter object (or a raw, already-encoded query string):

```ts
// Structured
const results = await kerygma.searchTranscripts({ topic: 'faith', year: 2024 })
console.log(results.interpreted)              // how the query was understood
for (const s of results.sermons) {
  console.log(s.title, s.dateFormatted, s.videoId)
}

// Natural-language (parsed server-side)
const nl = await kerygma.searchTranscripts({ q: 'sermons on prayer last March' })

// Raw query string
const raw = await kerygma.searchTranscripts('month=3&year=2024&speaker=Apostle')
```

Supported structured fields: `q`, `month`, `year`, `theme`, `topic`, `speaker`.
A `topic` is a **relevance** search (what the sermon is *about*), not a formal
theme name.

Fetch a single transcript and build its PDF download URL:

```ts
const view = await kerygma.getTranscript(results.sermons[0].videoId)
console.log(view.sermon.title)
console.log(view.transcript)        // full verbatim text
console.log(view.segments)          // timestamped segments

const pdfUrl = kerygma.transcriptDownloadUrl(view.sermon.videoId)
// → https://kerygma.example.com/transcripts/<id>/download
```

### Themes

```ts
const themes = await kerygma.listThemes() // { id, name }[]
```

### Admin / DB reads (require `adminSecret`)

```ts
await admin.getAdminStatus()            // { queueDepth, lastSyncAt, sermonCount }
await admin.getAdminJobs()              // Job[]
await admin.getStatusData()             // { queueDepth, jobs }
await admin.syncApi()                   // trigger a background API sync → { ok }
await admin.getDbTable('sermons', 50, 0) // paginated rows
```

`getDbTable(table, limit?, offset?)` accepts: `sermons`, `themes`,
`transcriptions`, `chunks`, `jobs`, `missing_sermons`.

---

## Method reference

| Method | Endpoint | Auth |
|---|---|---|
| `streamChat(messages, signal?)` | `POST /api/chat` (SSE) | public |
| `ask(messages, signal?)` | `POST /api/chat` (drained) | public |
| `searchTranscripts(params \| qs)` | `GET /api/transcripts/search` | public |
| `getTranscript(videoId)` | `GET /api/transcripts/:videoId` | public |
| `transcriptDownloadUrl(videoId)` | `GET /transcripts/:videoId/download` | public (URL helper) |
| `listThemes()` | `GET /api/themes` | public |
| `getAdminStatus()` | `GET /api/admin/status` | `X-Admin-Secret` |
| `getAdminJobs()` | `GET /api/admin/jobs` | `X-Admin-Secret` |
| `getStatusData()` | `GET /api/admin/status/data` | `X-Admin-Secret` |
| `syncApi()` | `POST /api/admin/sync-api` | `X-Admin-Secret` |
| `getDbTable(table, limit?, offset?)` | `GET /api/db/:table` | `X-Admin-Secret` |

---

## Error handling

Non-2xx responses throw `ApiError`, which carries the HTTP `status` and a message
(taken from the backend's `{ error }` body when present). A chat `error` frame
surfaced through `ask()` also throws `ApiError`.

```ts
import { ApiError } from '@kerygma/sdk'

try {
  await kerygma.getTranscript('does-not-exist')
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`Kerygma API error ${err.status}: ${err.message}`)
  } else {
    throw err
  }
}
```

---

## Runtimes

- **Node 18+** and modern browsers work out of the box (global `fetch` + Web
  Streams).
- **Older Node / non-standard runtimes:** inject a `fetch` whose response body
  supports `getReader()` (the SSE stream relies on it):

  ```ts
  import fetch from 'node-fetch'
  const kerygma = new KerygmaClient({
    baseUrl,
    fetch: fetch as unknown as typeof globalThis.fetch,
  })
  ```

---

## Keeping the contract in sync

The response types in `packages/sdk/src/types.ts` are a **third** hand-maintained
copy of the API contract, alongside `frontend/src/api/types.ts` and the source of
truth in `src/web/router.ts`. When a route's response shape changes on the
backend, update all three. The SDK is **read/query only** by design — it must not
gain ingestion/write helpers beyond what the public API already exposes.

---

## FAQ — can the SDK take the consumer's "client secret"?

**Short answer: partially, and only via the `fetch` escape hatch today.**

- The SDK has a first-class slot for exactly one credential — **Kerygma's admin
  secret** (`adminSecret` → `X-Admin-Secret`). That is the only secret the
  Kerygma API itself defines, and it is fixed at construction (there is no
  per-call override).
- It has **no dedicated option** for a *consumer's own* credential — e.g. a
  bearer token, OAuth access token, API-gateway key, or a reverse-proxy "client
  secret/client id" pair. There is no `headers` option and no request
  interceptor hook.
- The one supported way to attach such credentials is to **wrap `fetch`** (see
  [Adding your own auth](#adding-your-own-auth--gateway--bearer--client-secret)).
  Because every request — including the chat SSE stream — flows through the
  injected `fetch`, this reliably covers all calls. It is, however, a transport
  workaround rather than an ergonomic, typed API.

So: flexible enough to *work* for an arbitrary client secret, but not yet
*ergonomic* for it. If first-class consumer auth is wanted, the natural
enhancement would be a `headers` option (static or a `() => headers` provider)
on `KerygmaClientOptions`, merged into every request alongside the existing
`X-Admin-Secret` handling — a small, backward-compatible addition.
