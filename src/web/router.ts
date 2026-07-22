import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, normalize } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'
import { getRecentJobs, getQueueDepth, getQueuePosition } from '../queue.js'
import { syncFromApi } from '../scheduler.js'
import {
  searchChunks,
  getConfig,
  countSermons,
  listThemes,
  listSermons,
  getSermonByVideoId,
  getSermonsByDate,
  getSermonsByThemeName,
  getSermonsBySpeaker,
  searchSermons,
  searchSermonsByTopic,
  findSermonsByTitle,
  getTranscriptionBySermonId,
  getSermonIdsWithTranscription,
  resolveAliasToCanonical,
  insertBook,
  getBook,
  getBookChapters,
  getBookChapterCount,
  listBooks,
  DB_BROWSER_TABLES,
  getTableColumns,
  getTableRowCount,
  getTableRows,
  type SermonRow,
} from '../db/queries.js'
import type { TranscriptSegment } from '../ingestion/transcriber.js'
import { formatTimestamp } from '../ingestion/chunker.js'
import { formatSermonExcerpts } from '../citations.js'
import { errMsg } from '../utils.js'
import { logger } from '../logger.js'
import { enqueue } from '../queue.js'
import { generateBook } from '../book/generator.js'
import { generateBookPdf, bookPdfFilename } from './bookPdf.js'
import { generateTranscriptPdf, transcriptPdfFilename } from './transcriptPdf.js'
import { parseTranscriptQuery, type TranscriptQuery } from './transcriptQuery.js'
import { formatSermonDate, humanizeDatePrefix } from './transcriptFormat.js'

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', 'public')
const ASSETS_DIR = join(PUBLIC_DIR, 'assets')
// The Vite-built React SPA. Hono serves its files and falls back to index.html
// for client-side routes (see the catch-all at the end of createRouter).
const SPA_DIR = join(PUBLIC_DIR, 'app')

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const mimeFor = (file: string): string => MIME[extname(file)] ?? 'application/octet-stream'

// Simple in-memory rate limiter: 30 requests/min per IP on the chat endpoint
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

const MAX_TRANSCRIPT_RESULTS = 100

// Resolve a speaker filter (which may be an alias) to its canonical name, then
// substring-match it against a row's speaker. Shared by every lookup that
// accepts a speaker argument so alias resolution can't silently diverge
// between them.
function matchesSpeaker(rowSpeaker: string | null | undefined, filter: string): boolean {
  const canonical = resolveAliasToCanonical(filter)
  const sp = (canonical ?? filter).toLowerCase()
  return (rowSpeaker ?? '').toLowerCase().includes(sp)
}

// Resolve the filters to a sermon list. A base set is chosen by priority —
// topic (relevance) > theme (formal) > date > speaker — then the remaining
// filters are applied as predicates. `topic` is a relevance search over the
// sermon's section topics/summaries (what it is *about*), not a bare keyword
// match, so a common word like "faith" returns sermons geared towards faith
// rather than every sermon that happens to say it.
function resolveTranscriptSermons(f: TranscriptQuery): SermonRow[] {
  let rows: SermonRow[]
  let themeApplied = false

  if (f.topic) {
    rows = searchSermonsByTopic(f.topic, MAX_TRANSCRIPT_RESULTS)
    // If the chunker never tagged the topic, it may still be a formal theme.
    if (rows.length === 0) rows = getSermonsByThemeName(f.topic)
    // Last resort: treat the topic as a potential sermon title — catches cases
    // like "did Apostle teach on Drive?" where "Drive" is the literal title.
    if (rows.length === 0) rows = findSermonsByTitle(f.topic, MAX_TRANSCRIPT_RESULTS)
  } else if (f.theme) {
    rows = getSermonsByThemeName(f.theme)
    themeApplied = true
  } else if (f.date) {
    rows = getSermonsByDate(f.date)
  } else if (f.speaker) {
    rows = getSermonsBySpeaker(resolveAliasToCanonical(f.speaker) ?? f.speaker)
  } else {
    return []
  }

  if (f.date) rows = rows.filter((r) => r.date.startsWith(f.date as string))
  if (f.theme && !themeApplied) {
    const theme = f.theme.toLowerCase()
    rows = rows.filter((r) => (r.theme ?? '').toLowerCase().includes(theme))
  }
  if (f.speaker) rows = rows.filter((r) => matchesSpeaker(r.speaker, f.speaker as string))
  return rows.slice(0, MAX_TRANSCRIPT_RESULTS)
}

// Shape a sermon row for the transcripts table JSON response. `hasTranscript`
// is passed in (looked up in one batched query per request) rather than
// queried per row here.
function toTranscriptRow(s: SermonRow, hasTranscript: boolean): Record<string, unknown> {
  return {
    videoId: s.video_id,
    title: s.title,
    date: s.date,
    dateFormatted: formatSermonDate(s.date),
    theme: s.theme,
    excerpt: s.excerpt,
    speaker: s.speaker,
    hasTranscript,
    viewUrl: `/transcripts/${s.video_id}`,
    downloadUrl: `/transcripts/${s.video_id}/download`,
  }
}

// Human-readable summary of what was searched, shown above the results.
function describeInterpretation(f: TranscriptQuery, count: number): string {
  const parts: string[] = []
  if (f.topic) parts.push(`about “${f.topic}”`)
  if (f.theme) parts.push(`in “${f.theme}”`)
  if (f.speaker) parts.push(`by ${f.speaker}`)
  if (f.date) parts.push(`from ${humanizeDatePrefix(f.date)}`)
  const noun = count === 1 ? 'transcript' : 'transcripts'
  return parts.length > 0 ? `${count} ${noun} ${parts.join(' ')}` : `${count} ${noun}`
}

// ── Chat tool-use ──────────────────────────────────────────────────────────
// The chat is agentic: rather than feeding Claude a single relevance search,
// we give it read-only tools so it can choose the right lookup. The key one is
// list_sermons, which returns the COMPLETE roster for a filter (month, speaker,
// topic) — so enumeration questions ("all sermons in March") no longer miss
// sermons that a top-N keyword search happened not to surface.
type ChatSource = { title: string; date: string; timestamp?: string }
type ChatToolResult = { text: string; sources: ChatSource[] }

const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_sermon_excerpts',
    description:
      'Search the full text of all sermons for passages relevant to a topic or question. Returns the most relevant excerpts with sermon title, speaker, date, and timestamp. Use this for "what does X teach about Y" style questions where you need the actual words spoken. This returns a relevant sample, NOT a complete list — never use it to enumerate sermons.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The topic or question to search sermon content for' },
        speaker: { type: 'string', description: 'Optional speaker name (or partial name) to restrict results to' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_sermons',
    description:
      'List the COMPLETE set of sermons matching a filter — by month/date, topic, and/or speaker. Returns every matching sermon (title, date, speaker, theme), not just a relevant sample. Use this for any question asking for a full list or count, e.g. "what sermons were preached in March 2023", "list all sermons by Pst. Laju", "which sermons are about faith". When the user refers to "that month/series", resolve it from the conversation first, then call this with the concrete value.',
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Year, month, or day, as YYYY, YYYY-MM, or YYYY-MM-DD (e.g. "2023-03" for all of March 2023)',
        },
        topic: { type: 'string', description: 'Subject the sermons are about (e.g. "faith")' },
        speaker: { type: 'string', description: 'Speaker name or partial name' },
      },
    },
  },
  {
    name: 'find_sermon',
    description:
      'Look up a specific sermon by (part of) its title. Use this when a member asks for the link, video, or recording of a named sermon, OR when they ask "did X preach on Y" / "is there a sermon called Y" and Y could be a sermon title. Returns the sermon\'s details including the YouTube link if available. Optionally narrow by speaker or date. If no link is on file, the result says so.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Part or all of the sermon title to look up' },
        speaker: { type: 'string', description: 'Optional speaker name or partial name to narrow results' },
        date: {
          type: 'string',
          description: 'Optional year, month, or day (YYYY, YYYY-MM, or YYYY-MM-DD) to narrow results',
        },
      },
      required: ['title'],
    },
  },
]

function searchExcerptsTool(query: string, speaker?: string): ChatToolResult {
  // Filter by speaker in the query itself (not after the top-10 limit) so a
  // speaker filter narrows the ranked set instead of shrinking it.
  const resolvedSpeaker = speaker ? resolveAliasToCanonical(speaker) ?? speaker : undefined
  const chunks = searchChunks(query, 10, resolvedSpeaker)
  if (chunks.length === 0) {
    return { text: `No sermon excerpts found for "${query}".`, sources: [] }
  }
  const sources: ChatSource[] = chunks.map((c) => ({
    title: c.sermon_title,
    date: c.date,
    timestamp: formatTimestamp(c.timestamp_start),
  }))
  const text = formatSermonExcerpts(
    chunks.map((c) => ({ ...c, url: c.webpage_url ?? c.download_url ?? null })),
    { includeSpeaker: true }
  )
  return { text, sources }
}

function listSermonsTool(date?: string, topic?: string, speaker?: string): ChatToolResult {
  let rows = resolveTranscriptSermons({ date, topic, speaker })
  // No filter at all → fall back to the recent roster rather than nothing.
  if (rows.length === 0 && !date && !topic && !speaker) rows = listSermons(50)
  if (rows.length === 0) return { text: 'No sermons matched that filter.', sources: [] }

  const sources: ChatSource[] = rows.map((r) => ({ title: r.title, date: r.date }))
  const body = rows
    .map((r) => {
      const parts = [r.title, r.speaker ?? 'Unknown speaker', r.date]
      if (r.theme) parts.push(`Theme: ${r.theme}`)
      if (r.webpage_url) parts.push(`URL: ${r.webpage_url}`)
      return `• ${parts.join(' | ')}`
    })
    .join('\n')
  return { text: `${rows.length} sermon(s) matched (this is the complete list):\n${body}`, sources }
}

// Resolve a named sermon to its details so the chat can answer "what's the
// YouTube link for …" questions. Matches on the title (substring), optionally
// narrowed by speaker/date, and surfaces the webpage_url (the YouTube link).
function findSermonTool(title: string, speaker?: string, date?: string): ChatToolResult {
  if (!title) return { text: 'No sermon title was given to look up.', sources: [] }
  let rows = findSermonsByTitle(title, 10)
  if (speaker) rows = rows.filter((r) => matchesSpeaker(r.speaker, speaker))
  if (date) rows = rows.filter((r) => r.date.startsWith(date))
  if (rows.length === 0) {
    return { text: `No sermon found with a title matching "${title}".`, sources: [] }
  }
  const sources: ChatSource[] = rows.map((r) => ({ title: r.title, date: r.date }))
  const body = rows
    .map((r) => {
      const parts = [r.title, r.speaker ?? 'Unknown speaker', r.date]
      if (r.theme) parts.push(`Theme: ${r.theme}`)
      parts.push(r.webpage_url ? `YouTube: ${r.webpage_url}` : 'YouTube: (no link on file)')
      return `• ${parts.join(' | ')}`
    })
    .join('\n')
  return { text: `${rows.length} sermon(s) matched:\n${body}`, sources }
}

export function runChatTool(name: string, input: unknown): ChatToolResult {
  const args = (input ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  if (name === 'search_sermon_excerpts') {
    return searchExcerptsTool(str(args.query) ?? '', str(args.speaker))
  }
  if (name === 'list_sermons') {
    return listSermonsTool(str(args.date), str(args.topic), str(args.speaker))
  }
  if (name === 'find_sermon') {
    return findSermonTool(str(args.title) ?? '', str(args.speaker), str(args.date))
  }
  return { text: `Unknown tool: ${name}`, sources: [] }
}

export function createRouter(anthropic: Anthropic): Hono {
  const app = new Hono()

  // ── Static assets ──────────────────────────────────────────────────────
  app.get('/favicon.ico', (c) => c.redirect('/assets/favicon.png', 301))


  app.get('/assets/:file', (c) => {
    const file = c.req.param('file')
    try {
      const data = readFileSync(join(ASSETS_DIR, file))
      return new Response(data, { headers: { 'Content-Type': mimeFor(file), 'Cache-Control': 'public, max-age=86400' } })
    } catch {
      return c.notFound()
    }
  })

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true }))

  // ── Chat ───────────────────────────────────────────────────────────────
  app.post('/api/chat', async (c) => {
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    let body: { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { messages } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400)
    }

    if (countSermons() === 0) {
      return c.json(
        { error: 'No sermons indexed yet. Ask an administrator to ingest some first.' },
        404
      )
    }

    // Conversation history, as-is. Each turn re-runs the agentic loop from
    // scratch (no server-side session) — the tools re-query the DB live.
    const convo: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const systemPrompt = [
      `You are a sermon assistant for ${config.MINISTRY_NAME}.`,
      'You have read-only tools to look up the sermon library. Ground every answer about sermons in a tool result — never answer sermon questions from general knowledge.',
      '- For questions about what was taught on a topic, use search_sermon_excerpts and cite the title, speaker, date, and timestamp.',
      '- For questions that ask for a list or count of sermons — by month, date, speaker, or topic — use list_sermons. Its result is the COMPLETE, authoritative set for that filter. Present the full list and do NOT add disclaimers like "these are only the ones in the excerpts I was given".',
      '- Do not enumerate sermons from search_sermon_excerpts results; that tool returns a relevant sample and will miss sermons.',
      '- For the YouTube/video link, recording, or "where can I watch" of a specific named sermon, use find_sermon and share the YouTube link from the result. If the matched sermon has no link on file, say so plainly rather than inventing one.',
      '- When the user asks "did X teach on [Y]" or "is there a sermon on [Y]", Y may be a sermon title rather than a content topic. Call find_sermon with Y as the title to check — a sermon can be titled "Drive" even if the word barely appears in the transcript.',
      'When the user refers to "that month", "that series", or a previous result, resolve it from the conversation, then call the tool with the concrete value.',
      'If the user sends a greeting or makes small talk, welcome them warmly as a sermon assistant and invite them to ask about the sermons — do not call any tool.',
    ].join('\n')

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (s) => {
      const collected: ChatSource[] = []
      const seen = new Set<string>()
      const addSource = (src: ChatSource): void => {
        const key = `${src.title}|${src.date}|${src.timestamp ?? ''}`
        if (!seen.has(key)) { seen.add(key); collected.push(src) }
      }

      try {
        // Agentic loop: stream each turn's text; if the turn requests tools,
        // run them, feed the results back, and continue. Capped to avoid loops.
        for (let step = 0; step < 6; step++) {
          const msgStream = anthropic.messages.stream({
            model: config.CLAUDE_MODEL,
            // Headroom for a full list_sermons roster (up to 100 rows) so a
            // "complete list" answer isn't truncated at the output layer.
            max_tokens: 3072,
            // One cache_control breakpoint on the system prompt caches the
            // tools+system prefix, so the follow-up call(s) in the loop read it
            // at ~0.1x instead of re-paying full input price.
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: CHAT_TOOLS,
            messages: convo,
          })

          for await (const event of msgStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              await s.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`)
            }
          }

          const final = await msgStream.finalMessage()
          convo.push({ role: 'assistant', content: final.content })

          if (final.stop_reason !== 'tool_use') break

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of final.content) {
            if (block.type !== 'tool_use') continue
            const result = runChatTool(block.name, block.input)
            result.sources.forEach(addSource)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.text })
          }

          // Surface citations as they're discovered, before the answer streams.
          if (collected.length > 0) {
            await s.write(`data: ${JSON.stringify({ type: 'context', sources: collected })}\n\n`)
          }
          convo.push({ role: 'user', content: toolResults })
        }

        await s.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      } catch (err) {
        logger.error(`Chat stream error: ${errMsg(err)}`)
        await s.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred. Please try again.' })}\n\n`)
      }
    })
  })

  // ── Transcripts ─────────────────────────────────────────────────────────
  // Theme list for the structured filter dropdown in the SPA.
  app.get('/api/themes', (c) =>
    c.json(listThemes().map((t) => ({ id: t.id, name: t.name })))
  )

  // Search endpoint — `q` (natural language) plus optional structured filters.
  // Explicit month/year/theme/speaker params always take priority over NLP-detected values.
  app.get('/api/transcripts/search', async (c) => {
    const q = c.req.query('q')?.trim()
    const year = c.req.query('year')?.trim()
    const month = c.req.query('month')?.trim()
    const explicitDate = year && month ? `${year}-${month}` : year || undefined
    const explicitTheme = c.req.query('theme')?.trim() || undefined
    const explicitSpeaker = c.req.query('speaker')?.trim() || undefined
    let filters: TranscriptQuery
    let sermons: SermonRow[]

    if (q) {
      const nlp = await parseTranscriptQuery(q, anthropic)
      // Explicit URL params override NLP-extracted values.
      filters = {
        date: explicitDate ?? nlp.date,
        theme: explicitTheme ?? nlp.theme,
        topic: nlp.topic,
        speaker: explicitSpeaker ?? nlp.speaker,
      }
      sermons = resolveTranscriptSermons(filters)
      // NLP found nothing structured and no explicit filters — fall back to keyword search.
      if (sermons.length === 0 && !filters.date && !filters.topic && !filters.speaker && !filters.theme) {
        sermons = searchSermons(q, MAX_TRANSCRIPT_RESULTS)
      }
    } else {
      filters = {
        date: explicitDate,
        theme: explicitTheme,
        topic: c.req.query('topic')?.trim() || undefined,
        speaker: explicitSpeaker,
      }
      sermons = resolveTranscriptSermons(filters)
    }

    const transcribedIds = getSermonIdsWithTranscription(sermons.map((s) => s.id))
    return c.json({
      interpreted: describeInterpretation(filters, sermons.length),
      sermons: sermons.map((s) => toTranscriptRow(s, transcribedIds.has(s.id))),
    })
  })

  // Viewable transcript as JSON — the SPA renders it from stored segments
  // (or splits the verbatim text into paragraphs when segments are absent).
  app.get('/api/transcripts/:videoId', (c) => {
    const sermon = getSermonByVideoId(c.req.param('videoId'))
    if (!sermon || sermon.ingestion_status !== 'done') return c.notFound()

    const row = getTranscriptionBySermonId(sermon.id)
    let segments: TranscriptSegment[] = []
    if (row) {
      try {
        segments = JSON.parse(row.segments) as TranscriptSegment[]
      } catch {
        segments = []
      }
    }
    return c.json({
      sermon: {
        videoId: sermon.video_id,
        title: sermon.title,
        date: sermon.date,
        dateFormatted: formatSermonDate(sermon.date),
        speaker: sermon.speaker,
        theme: sermon.theme,
      },
      segments,
      transcript: row?.transcript ?? '',
      hasTranscript: row !== null,
    })
  })

  // On-demand PDF of the transcript — generated per request with pdfkit.
  app.get('/transcripts/:videoId/download', async (c) => {
    const sermon = getSermonByVideoId(c.req.param('videoId'))
    if (!sermon || sermon.ingestion_status !== 'done') return c.notFound()

    const row = getTranscriptionBySermonId(sermon.id)
    if (!row) {
      return c.json({ error: 'No transcript available for this sermon' }, 404)
    }

    try {
      const pdf = await generateTranscriptPdf(sermon, row.transcript)
      return new Response(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${transcriptPdfFilename(sermon)}"`,
        },
      })
    } catch (err) {
      logger.error(`Transcript PDF error: ${errMsg(err)}`)
      return c.json({ error: 'Failed to generate PDF' }, 500)
    }
  })

  // ── Books ─────────────────────────────────────────────────────────────────
  // On-demand PDF of a generated book draft — rendered per request from the
  // stored chapters (Markdown lives in SQLite, which Litestream replicates; a
  // PDF written to the ephemeral container's disk would not survive a restart).
  app.get('/books/:id/download', async (c) => {
    const id = parseInt(c.req.param('id'), 10)
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid book id' }, 400)

    const book = getBook(id)
    if (!book) return c.notFound()
    if (book.status !== 'done') {
      return c.json({ error: `Book is not ready (status: ${book.status})` }, 409)
    }

    try {
      const pdf = await generateBookPdf(book, getBookChapters(id))
      return new Response(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${bookPdfFilename(book)}"`,
        },
      })
    } catch (err) {
      logger.error(`Book PDF error: ${errMsg(err)}`)
      return c.json({ error: 'Failed to generate PDF' }, 500)
    }
  })

  // ── Admin auth middleware ───────────────────────────────────────────────
  const adminMiddleware = async (
    c: Parameters<Parameters<Hono['use']>[1]>[0],
    next: () => Promise<void>
  ) => {
    const secret = c.req.header('X-Admin-Secret')
    if (secret !== config.ADMIN_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  }

  // All admin + DB data endpoints sit under protected prefixes. The admin/live
  // and /lyrical-theology *pages* are now client-side routes served by the SPA
  // catch-all; only their data APIs are guarded here.
  app.use('/api/admin/*', adminMiddleware)
  app.use('/api/db/*', adminMiddleware)

  app.get('/api/admin/jobs', (c) => {
    return c.json(getRecentJobs(50))
  })

  app.get('/api/admin/status', (c) => {
    return c.json({
      queueDepth: getQueueDepth(),
      lastSyncAt: getConfig('last_sync_at'),
      sermonCount: countSermons(),
    })
  })

  app.post('/api/admin/sync-api', async (c) => {
    void syncFromApi(anthropic)
    return c.json({ ok: true, message: 'API sync started in background' }, 202)
  })

  // Kick off a book draft on a topic. Creates the book row up-front (so its
  // download URL is known immediately) and runs generation as a background job,
  // which appears in the jobs dashboard like any other.
  app.post('/api/admin/book-gen', async (c) => {
    let body: { topic?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (!topic) return c.json({ error: 'A non-empty "topic" is required' }, 400)

    if (countSermons() === 0) {
      return c.json({ error: 'No sermons indexed yet — ingest some first.' }, 404)
    }

    const bookId = insertBook(topic)
    const downloadUrl = `/books/${bookId}/download`
    const jobId = enqueue((ctx) => generateBook({ bookId, topic }, anthropic, ctx), {
      title: `Book: ${topic}`,
      downloadUrl,
      payload: JSON.stringify({ bookId, topic }),
    })
    return c.json({ jobId, bookId, downloadUrl }, 202)
  })

  // List generated books (newest first) for the admin UI. `chaptersGenerated`
  // vs `chapterCount` drives the live progress column on the book page.
  app.get('/api/admin/books', (c) => {
    return c.json(
      listBooks(50).map((b) => ({
        id: b.id,
        topic: b.topic,
        title: b.title,
        status: b.status,
        chapterCount: b.chapter_count,
        chaptersGenerated: getBookChapterCount(b.id),
        createdAt: b.created_at,
        downloadUrl: `/books/${b.id}/download`,
      }))
    )
  })

  // Snapshot for the live status dashboard: recent jobs (queued ones carry
  // their 1-based queue position) plus current queue depth.
  app.get('/api/admin/status/data', (c) => {
    const jobs = getRecentJobs(50).map((job) =>
      job.status === 'queued' ? { ...job, position: getQueuePosition(job.id) } : job
    )
    return c.json({ queueDepth: getQueueDepth(), jobs })
  })

  // ── DB Browser data API ─────────────────────────────────────────────────
  app.get('/api/db/:table', (c) => {
    const table = c.req.param('table')
    if (!DB_BROWSER_TABLES.has(table)) {
      return c.json({ error: 'Unknown table' }, 400)
    }

    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200)
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10))

    const columns = getTableColumns(table)
    const count = getTableRowCount(table)
    const rawRows = getTableRows(table, limit, offset)

    const rows = rawRows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        out[k] = Buffer.isBuffer(v) ? `[blob: ${v.length}B]` : v
      }
      return out
    })

    return c.json({ columns, rows, total: count, limit, offset })
  })

  // ── SPA (Vite build) ─────────────────────────────────────────────────────
  // Serve built static files; fall back to index.html for any non-API GET so
  // client-side routes (/admin, /transcripts/:id, …) resolve. Registered last
  // so it never shadows the API or asset routes above.
  const indexHtmlPath = join(SPA_DIR, 'index.html')

  app.get('*', (c) => {
    const urlPath = decodeURIComponent(new URL(c.req.url).pathname)

    // Resolve to a file inside SPA_DIR, guarding against path traversal.
    const candidate = normalize(join(SPA_DIR, urlPath))
    if (candidate.startsWith(SPA_DIR) && existsSync(candidate) && statSync(candidate).isFile()) {
      // Vite emits content-hashed files under /static — safe to cache forever.
      const isHashed = candidate.startsWith(join(SPA_DIR, 'static'))
      const cache = isHashed ? 'public, max-age=31536000, immutable' : 'no-cache'
      return new Response(readFileSync(candidate), {
        headers: { 'Content-Type': mimeFor(candidate), 'Cache-Control': cache },
      })
    }

    if (existsSync(indexHtmlPath)) {
      return new Response(readFileSync(indexHtmlPath), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    }

    // Build not present (e.g. running the backend alone in dev — use the Vite
    // dev server on :5173 instead).
    return c.text('Frontend build not found. Run `yarn build:web` or use the Vite dev server.', 404)
  })

  return app
}
