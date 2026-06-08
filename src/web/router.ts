import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join, extname } from 'path'
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
  searchSermons,
  searchSermonsByTopic,
  getTranscriptionBySermonId,
  type SermonRow,
} from '../db/queries.js'
import type { TranscriptSegment } from '../ingestion/transcriber.js'
import { formatTimestamp } from '../ingestion/chunker.js'
import { errMsg } from '../utils.js'
import { logger } from '../logger.js'
import { adminHtml } from './adminHtml.js'
import { statusHtml } from './statusHtml.js'
import { dbHtml } from './dbHtml.js'
import { chatHtml } from './chatHtml.js'
import { transcriptsHtml } from './transcriptsHtml.js'
import { transcriptViewHtml } from './transcriptViewHtml.js'
import { generateTranscriptPdf, transcriptPdfFilename } from './transcriptPdf.js'
import { parseTranscriptQuery, type TranscriptQuery } from './transcriptQuery.js'
import { formatSermonDate, humanizeDatePrefix } from './transcriptFormat.js'
import { getDb } from '../db/connection.js'

const ASSETS_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', 'public', 'assets')

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

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
  } else if (f.theme) {
    rows = getSermonsByThemeName(f.theme)
    themeApplied = true
  } else if (f.date) {
    rows = getSermonsByDate(f.date)
  } else if (f.speaker) {
    rows = listSermons(500)
  } else {
    return []
  }

  if (f.date) rows = rows.filter((r) => r.date.startsWith(f.date as string))
  if (f.theme && !themeApplied) {
    const theme = f.theme.toLowerCase()
    rows = rows.filter((r) => (r.theme ?? '').toLowerCase().includes(theme))
  }
  if (f.speaker) {
    const sp = f.speaker.toLowerCase()
    rows = rows.filter((r) => (r.speaker ?? '').toLowerCase().includes(sp))
  }
  return rows.slice(0, MAX_TRANSCRIPT_RESULTS)
}

// Shape a sermon row for the transcripts table JSON response.
function toTranscriptRow(s: SermonRow): Record<string, unknown> {
  return {
    videoId: s.video_id,
    title: s.title,
    date: s.date,
    dateFormatted: formatSermonDate(s.date),
    theme: s.theme,
    excerpt: s.excerpt,
    speaker: s.speaker,
    hasTranscript: getTranscriptionBySermonId(s.id) !== null,
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

export function createRouter(anthropic: Anthropic): Hono {
  const app = new Hono()

  // ── Static assets ──────────────────────────────────────────────────────
  app.get('/favicon.ico', (c) => c.redirect('/assets/favicon.png', 301))


  app.get('/assets/:file', (c) => {
    const file = c.req.param('file')
    try {
      const data = readFileSync(join(ASSETS_DIR, file))
      const mime = MIME[extname(file)] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' } })
    } catch {
      return c.notFound()
    }
  })

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true }))

  // ── Chat ───────────────────────────────────────────────────────────────
  app.get('/', (c) => c.html(chatHtml()))

  app.post('/', async (c) => {
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

    let lastUserMessage = messages[0].content
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserMessage = messages[i].content; break }
    }

    const chunks = searchChunks(lastUserMessage, 10)
    if (chunks.length === 0) {
      return c.json(
        { error: 'No sermons indexed yet. Ask an administrator to ingest some first.' },
        404
      )
    }

    const sources = chunks.map((ch) => ({
      title: ch.sermon_title,
      date: ch.date,
      timestamp: formatTimestamp(ch.timestamp_start),
    }))

    const context = chunks
      .map((ch) => {
        const url = ch.webpage_url ?? ch.download_url ?? null
        const header = [
          ch.sermon_title,
          ch.speaker ?? 'Unknown',
          ch.date,
          formatTimestamp(ch.timestamp_start),
          ...(url ? [`URL: ${url}`] : []),
        ].join(' | ')
        return `[${header}]\n${ch.content}`
      })
      .join('\n\n')

    const systemPrompt = [
      `You are a sermon assistant for ${config.MINISTRY_NAME}.`,
      'If the user sends a greeting or makes small talk, welcome them warmly, introduce yourself as a sermon assistant, and invite them to ask about the sermons — do not reference any sermon content.',
      'For sermon questions, answer based solely on the excerpts below.',
      'When referencing content, cite the exact sermon title, speaker, date, and timestamp as they appear in the excerpt headers.',
      'If the question cannot be answered from the excerpts, say so clearly.',
      '',
      context,
    ].join('\n')

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (s) => {
      await s.write(`data: ${JSON.stringify({ type: 'context', sources })}\n\n`)

      try {
        const msgStream = await anthropic.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages as Array<{ role: 'user' | 'assistant'; content: string }>,
          stream: true,
        })

        for await (const event of msgStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            await s.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`)
          }
        }

        await s.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      } catch (err) {
        logger.error(`Chat stream error: ${errMsg(err)}`)
        await s.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred. Please try again.' })}\n\n`)
      }
    })
  })

  // ── Transcripts ─────────────────────────────────────────────────────────
  // Page shell + theme list for the structured filter dropdown.
  app.get('/transcripts', (c) => c.html(transcriptsHtml(listThemes())))

  // Search endpoint — `q` (natural language) OR structured month/year/theme/speaker.
  // Registered before /transcripts/:videoId so "search" isn't read as a video id.
  app.get('/transcripts/search', async (c) => {
    const q = c.req.query('q')?.trim()
    let filters: TranscriptQuery
    let sermons: SermonRow[]

    if (q) {
      filters = await parseTranscriptQuery(q, anthropic)
      sermons = resolveTranscriptSermons(filters)
      // The parser found nothing structured — treat the raw text as keywords.
      if (sermons.length === 0 && !filters.date && !filters.topic && !filters.speaker) {
        sermons = searchSermons(q, MAX_TRANSCRIPT_RESULTS)
      }
    } else {
      const year = c.req.query('year')?.trim()
      const month = c.req.query('month')?.trim()
      const date = year && month ? `${year}-${month}` : year || undefined
      filters = {
        date,
        theme: c.req.query('theme')?.trim() || undefined,
        topic: c.req.query('topic')?.trim() || undefined,
        speaker: c.req.query('speaker')?.trim() || undefined,
      }
      sermons = resolveTranscriptSermons(filters)
    }

    return c.json({
      interpreted: describeInterpretation(filters, sermons.length),
      sermons: sermons.map(toTranscriptRow),
    })
  })

  // Viewable transcript (rendered from stored segments / verbatim text).
  app.get('/transcripts/:videoId', (c) => {
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
    return c.html(transcriptViewHtml(sermon, segments, row?.transcript ?? ''))
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

  // ── Admin UI ───────────────────────────────────────────────────────────
  app.get('/admin', (c) => {
    return c.html(adminHtml())
  })

  // Live phase/queue dashboard — public HTML, data endpoint is protected
  app.get('/admin/live', (c) => c.html(statusHtml()))

  app.use('/admin/jobs', adminMiddleware)
  app.use('/admin/status', adminMiddleware)
  app.use('/admin/status/data', adminMiddleware)
  app.use('/admin/sync-api', adminMiddleware)

  app.get('/admin/jobs', (c) => {
    return c.json(getRecentJobs(50))
  })

  app.get('/admin/status', (c) => {
    return c.json({
      queueDepth: getQueueDepth(),
      lastSyncAt: getConfig('last_sync_at'),
      sermonCount: countSermons(),
    })
  })

  app.post('/admin/sync-api', async (c) => {
    void syncFromApi(anthropic)
    return c.json({ ok: true, message: 'API sync started in background' }, 202)
  })

  // ── DB Browser UI + data API ───────────────────────────────────────────
  const DB_TABLES = new Set(['sermons', 'themes', 'transcriptions', 'chunks', 'jobs'])

  app.get('/lyrical-theology', (c) => c.html(dbHtml()))

  app.use('/lyrical-theology/:table', adminMiddleware)

  app.get('/lyrical-theology/:table', (c) => {
    const table = c.req.param('table')
    if (!DB_TABLES.has(table)) {
      return c.json({ error: 'Unknown table' }, 400)
    }

    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200)
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10))

    const db = getDb()
    const pragma = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    const columns = pragma.map((r) => r.name)
    const { count } = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
    const rawRows = db
      .prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Record<string, unknown>[]

    const rows = rawRows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        out[k] = Buffer.isBuffer(v) ? `[blob: ${v.length}B]` : v
      }
      return out
    })

    return c.json({ columns, rows, total: count, limit, offset })
  })

  // Snapshot for the live status dashboard: recent jobs (queued ones carry
  // their 1-based queue position) plus current queue depth.
  app.get('/admin/status/data', (c) => {
    const jobs = getRecentJobs(50).map((job) =>
      job.status === 'queued' ? { ...job, position: getQueuePosition(job.id) } : job
    )
    return c.json({ queueDepth: getQueueDepth(), jobs })
  })

  return app
}
