# Chat Feature

The chat UI lets church members ask questions about sermons in plain English and receive answers grounded in actual sermon content, with citations.

---

## Overview

The chat is **agentic**: instead of pre-running one search and stuffing the results into the prompt, the backend hands Claude a small set of read-only tools and lets it choose the lookup. Claude is still constrained to the library — it must ground every sermon answer in a tool result, never general knowledge — but it now picks the *right kind* of lookup for the question. The motivating fix: enumeration questions ("what sermons were preached that month?") need the **complete** roster, which a top-N relevance search cannot guarantee. The `list_sermons` tool returns the full set; `search_sermon_excerpts` covers content questions.

---

## End-to-End Flow

### 1. User sends a message

The frontend (`frontend/src/pages/ChatPage.tsx`) keeps the conversation in React state for the duration of the session. When the user submits:

- The message is appended as `{ role: 'user', content: text }`
- The entire conversation is POST'd to `/api/chat` via `streamChat()` (`frontend/src/api/client.ts`)
- A typing indicator appears while waiting

### 2. Backend sets up the agentic loop

The POST handler in `src/web/router.ts`:

- Returns **404** if the library is empty (`countSermons() === 0`).
- Maps the conversation history into `Anthropic.MessageParam[]` as-is (there's no server-side session — each turn re-runs the loop and re-queries the DB live).
- Builds a fixed system prompt and the tool definitions (`CHAT_TOOLS`).

### 3. Tools

Three read-only tools, dispatched by `runChatTool()` in `src/web/router.ts`:

| Tool | Backed by | Use for |
|------|-----------|---------|
| `search_sermon_excerpts` | `searchChunks()` (FTS5, top 10) | "What does X teach about Y" — returns a relevant **sample** of excerpts with citations |
| `list_sermons` | `resolveTranscriptSermons()` (date / topic / speaker) | "List/count sermons in month X / by speaker / about topic" — returns the **complete** matching roster |
| `find_sermon` | `findSermonsByTitle()` (title `LIKE`, optional speaker/date) | "What's the YouTube link / video / recording for the sermon on X" — returns the named sermon's details including its **YouTube link** (`webpage_url`) |

`search_sermon_excerpts` still uses `sanitizeFtsQuery()` under the hood (strips FTS5 special chars and stopwords, wraps tokens in `OR`). `list_sermons` resolves a `{date, topic, speaker}` filter to the full sermon list — by priority topic > theme > date > speaker, then applies the remaining filters as predicates (the same resolver the transcripts page uses). **This is the completeness guarantee:** a month query hits `getSermonsByDate('2023-03')` and returns every sermon in March, not whatever ranked in a keyword search.

`find_sermon` matches the requested text against the sermon **title** (case-insensitive substring), so a member can name a sermon and get its watch link without knowing the exact title. When the matched sermon has no `webpage_url` on file the result says `YouTube: (no link on file)` and the system prompt instructs Claude to say so plainly rather than invent a URL.

All three tools' optional `speaker` filter resolves aliases the same way, via a shared `matchesSpeaker()` helper in `router.ts` (alias → canonical name via `resolveAliasToCanonical`, then a case-insensitive substring match) — this used to be reimplemented per tool and had drifted, so `find_sermon` silently skipped alias resolution. `search_sermon_excerpts` pushes the resolved speaker into the `searchChunks()` SQL query itself (rather than filtering the top-10 rows in JS afterward), so a speaker filter narrows the ranked set instead of shrinking a fixed-size sample.

The system prompt steers tool selection explicitly: use `list_sermons` (not excerpt search) for any list/count, treat its result as the authoritative complete set, and don't caveat with "these are only the ones in the excerpts I was given" — the exact failure mode that motivated this design. For a link/video request about a named sermon, it routes to `find_sermon`.

### 4. Agentic loop & streaming

The backend uses SSE and runs a capped loop (max 6 steps) per turn. For each step it opens an `anthropic.messages.stream(...)` with the tools attached:

- Text deltas stream to the client as `delta` events as they arrive.
- After the turn, `finalMessage()` is inspected. If `stop_reason !== 'tool_use'`, the loop ends.
- Otherwise each `tool_use` block is run through `runChatTool()`, citations are accumulated and emitted as a `context` event, the `tool_result` blocks are appended to the conversation, and the loop continues.

**Prompt caching:** a single `cache_control` breakpoint sits on the system prompt, so the tools + system prefix (byte-identical across every call in the loop and across turns) is read at ~0.1× input cost on follow-up calls instead of re-paying full price. This absorbs most of the extra cost of the multi-call loop.

Because citations can arrive after a brief preamble, the frontend's `applySources()` attaches or refreshes the sources `<details>` whenever a `context` event lands — even if the answer bubble already exists.

### 5. Streaming events

The backend emits these SSE event types:

| Event | When | Payload |
|-------|------|---------|
| `context` | After a tool runs (cumulative sources so far) | `{ type: 'context', sources: [{title, date, timestamp?}] }` |
| `delta` | As Claude streams tokens | `{ type: 'delta', text: '...' }` |
| `done` | When the loop ends (terminal turn) | `{ type: 'done' }` |
| `error` | On exception | `{ type: 'error', message: '...' }` |

Sources are emitted as they're discovered (after each tool call), not necessarily before the first token — `timestamp` is present for excerpt citations and omitted for `list_sermons` rows.

Claude is called with:
- Model: `claude-sonnet-4-6` (configurable via `CLAUDE_MODEL`)
- Max tokens: 3072 per turn (headroom for a full `list_sermons` roster)
- The full conversation history (multi-turn support)
- The system prompt (cached) + `CHAT_TOOLS`

### 6. Frontend renders the response

`ChatPage` consumes the `streamChat()` async generator, which parses the SSE frames:

- On `context` — stores sources on the current assistant turn; the `<details>` attaches/refreshes even if it arrives before the answer text
- On `delta` — the assistant bubble replaces the typing dots on the first token, then markdown (`marked`) re-renders incrementally as text accumulates
- On `done` — the turn is marked complete and stays in state for future turns
- On `error` — drops the empty assistant placeholder and shows an error banner

Sources appear as a collapsible `<details>` element below the response bubble, showing sermon title, date, and (for excerpts) timestamp. The `section_name` from the chunk is not surfaced in the Sources widget — only the sermon-level metadata is shown.

---

## Multi-Turn Conversations

The entire conversation history is kept client-side and sent to the backend on every request. There is no server-side session. This means:

- Conversations persist across page refreshes, tab closes, and browser restarts — `ConversationsContext` mirrors all conversations (and the active tab) to `localStorage` under the `kerygma_convos` key, so a returning member finds their chats waiting. Use the "New" button / `+` tab to start a fresh conversation; closing a tab removes that conversation from the saved state.
- Persistence is per-device/browser (no auth, no server-side session), and transient flags are sanitised on load: `busy`/`error` reset and any mid-stream `streaming` turn is finalised so a reload never restores a stuck "typing" bubble.
- Claude can reference earlier exchanges in follow-up answers
- Each turn independently re-runs the agentic loop and re-queries the DB, so answers always reflect the current library — and "that month/series" references resolve from the conversation before the tool call

---

## Greeting Handling

The system prompt explicitly instructs Claude to respond warmly to greetings and small talk without citing any sermon content. This prevents unhelpful responses like citing a random sermon when the user says "hello".

---

## Limits and Defaults

| Parameter | Value | Where set |
|-----------|-------|-----------|
| Chunks per `search_sermon_excerpts` call | 10 | `router.ts` → `searchChunks(query, 10)` |
| Sermons per `list_sermons` call | up to `MAX_TRANSCRIPT_RESULTS` (100) | `router.ts` → `resolveTranscriptSermons` |
| Sermons per `find_sermon` call | up to 10 | `router.ts` → `findSermonsByTitle(title, 10)` |
| Max agentic loop steps per turn | 6 | `router.ts` → `for (let step = 0; step < 6; …)` |
| Max tokens per Claude turn | 3072 | `router.ts` → `max_tokens: 3072` |
| Chat rate limit | 30 req/min per IP | `router.ts` → `POST /api/chat` |
| Claude model | `claude-sonnet-4-6` (overridable) | `config.ts` → `CLAUDE_MODEL` |

Note: the MCP `search_teachings` tool retrieves up to 20 chunks (not 10) because it groups results by sermon and presents them structured rather than as a synthesised narrative.

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/pages/ChatPage.tsx` | Chat UI, message rendering, streaming bubbles, sources `<details>` |
| `frontend/src/api/client.ts` | `streamChat()` — SSE reader / async generator of chat events |
| `src/web/router.ts` | `POST /api/chat` handler, agentic loop, `CHAT_TOOLS`, `runChatTool()` |
| `src/db/queries.ts` | `searchChunks()`, `getSermonsByDate()`, `sanitizeFtsQuery()`, FTS5 query |
| `src/ingestion/chunker.ts` | `formatTimestamp()` used in context headers |
| `src/logger.ts` | Runtime logging (Winston) |
| `src/config.ts` | `MINISTRY_NAME`, `CLAUDE_MODEL` |
