# Chat Feature

The chat UI lets church members ask questions about sermons in plain English and receive answers grounded in actual sermon content, with citations.

---

## Overview

Every question triggers a search of the sermon database first, then passes the matching content to Claude as context. Claude never answers from general knowledge — it is constrained to the retrieved excerpts.

---

## End-to-End Flow

### 1. User sends a message

The frontend (`src/web/chatHtml.ts`) maintains a `messages` array in memory for the duration of the session. When the user submits:

- The message is appended to `messages` as `{ role: 'user', content: text }`
- The entire `messages` array is POST'd to `/`
- A typing indicator appears while waiting

### 2. Backend extracts the search query

The POST handler in `src/web/router.ts` walks backwards through the messages array to find the most recent user message. This is used as the search query — not the first message, not a summary, just the latest thing the user asked.

### 3. FTS5 search

`searchChunks()` in `src/db/queries.ts` queries the SQLite FTS5 index:

```sql
SELECT c.*, s.title, s.date, s.speaker, s.webpage_url ...
FROM chunks_fts
JOIN chunks c ON c.id = fts.rowid
JOIN sermons s ON s.id = c.sermon_id
WHERE chunks_fts MATCH ?
ORDER BY rank
LIMIT 10
```

Before hitting the DB, `sanitizeFtsQuery()` cleans the query:
- Strips FTS5 special characters (`" ' * ( ) ^ ~ -`)
- Removes stopwords (`a`, `the`, `and`, `or`, etc.)
- Wraps each remaining token in quotes and joins with `OR`

**Example:**
- Input: `"What does the Bible say about faith?"`
- Output: `"What" OR "Bible" OR "faith"`

OR semantics mean any chunk matching at least one token is returned, ranked by FTS5's built-in relevance scoring. If nothing is found, the request returns a 404 with a message asking the admin to ingest sermons.

### 4. Context is built

Each of the 10 retrieved chunks is formatted into a header + content block:

```
[Sermon Title | Speaker | Date | MM:SS | URL: ...]
The actual chunk text from the sermon...
```

Timestamps are formatted as `MM:SS` (e.g. `12:35`). All blocks are concatenated and appended to the system prompt.

### 5. System prompt

```
You are a sermon assistant for {MINISTRY_NAME}.
If the user sends a greeting or makes small talk, welcome them warmly,
introduce yourself as a sermon assistant, and invite them to ask about
the sermons — do not reference any sermon content.
For sermon questions, answer based solely on the excerpts below.
When referencing content, cite the exact sermon title, speaker, date,
and timestamp as they appear in the excerpt headers.
If the question cannot be answered from the excerpts, say so clearly.

[context blocks...]
```

The context is rebuilt fresh on every request using the latest search results, so follow-up questions always search for new relevant chunks rather than being stuck with the first question's results.

### 6. Streaming response

The backend uses SSE (Server-Sent Events) to stream the response. Three event types are emitted:

| Event | When | Payload |
|-------|------|---------|
| `context` | Immediately, before Claude starts | `{ type: 'context', sources: [{title, date, timestamp}] }` |
| `delta` | As Claude streams tokens | `{ type: 'delta', text: '...' }` |
| `done` | When Claude finishes | `{ type: 'done' }` |
| `error` | On exception | `{ type: 'error', message: '...' }` |

The `context` event fires first so the UI can display sources before the answer even begins.

Claude is called with:
- Model: `claude-sonnet-4-20250514` (configurable via `CLAUDE_MODEL`)
- Max tokens: 2048
- The full conversation history (multi-turn support)
- The system prompt with sermon context

### 7. Frontend renders the response

`readStream()` in `chatHtml.ts` reads the SSE stream:

- On `context` — stores sources for display
- On `delta` — creates the assistant bubble on first token, then appends text incrementally (streaming effect)
- On `done` — pushes the completed assistant message to the `messages` array for future turns
- On `error` — removes the typing indicator and shows an error banner

Sources appear as a collapsible `<details>` element below the response bubble, showing sermon title, date, and timestamp for each matched chunk.

---

## Multi-Turn Conversations

The entire conversation history is kept client-side and sent to the backend on every request. There is no server-side session. This means:

- Conversation context is lost on page refresh (by design — the "New conversation" button does a `location.reload()`)
- Claude can reference earlier exchanges in follow-up answers
- Each turn independently re-searches the DB with the latest user message, so the context window always reflects the current question

---

## Greeting Handling

The system prompt explicitly instructs Claude to respond warmly to greetings and small talk without citing any sermon content. This prevents unhelpful responses like citing a random sermon when the user says "hello".

---

## Key Files

| File | Role |
|------|------|
| `src/web/chatHtml.ts` | Frontend UI, SSE parsing, message rendering |
| `src/web/router.ts` | POST `/` handler, search, context building, Claude streaming |
| `src/db/queries.ts` | `searchChunks()`, `sanitizeFtsQuery()`, FTS5 query |
| `src/ingestion/chunker.ts` | `formatTimestamp()` used in context headers |
| `src/config.ts` | `MINISTRY_NAME`, `CLAUDE_MODEL` |
