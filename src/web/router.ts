import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'
import { enqueue, getJob, getRecentJobs, getQueueDepth } from '../queue.js'
import { ingestSermon, type IngestRequest } from '../ingestion/pipeline.js'
import { searchChunks } from '../db/queries.js'
import { formatTimestamp } from '../ingestion/chunker.js'
import { errMsg } from '../utils.js'
import { logger } from '../logger.js'
import { adminHtml } from './adminHtml.js'
import { dbHtml } from './dbHtml.js'
import { chatHtml } from './chatHtml.js'
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

const MAX_QUEUE_DEPTH = 50

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

  app.use('/admin/ingest', adminMiddleware)
  app.use('/admin/jobs', adminMiddleware)
  app.use('/admin/jobs/:id', adminMiddleware)

  app.post('/admin/ingest', async (c) => {
    let req: IngestRequest
    try {
      req = await c.req.json<IngestRequest>()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (!req.downloadUrl || !req.title || !req.speaker || !req.date) {
      return c.json({ error: 'downloadUrl, title, speaker, and date are required' }, 400)
    }
    if (req.series && typeof req.series !== 'string') {
      return c.json({ error: 'series must be a string' }, 400)
    }

    if (getQueueDepth() >= MAX_QUEUE_DEPTH) {
      return c.json({ error: 'Queue is full, try again later' }, 503)
    }

    const jobId = enqueue(() => ingestSermon(req, anthropic), {
      title: req.title,
      downloadUrl: req.downloadUrl,
      payload: JSON.stringify(req),
    })
    return c.json({ jobId }, 202)
  })

  app.get('/admin/jobs', (c) => {
    return c.json(getRecentJobs(50))
  })

  app.get('/admin/jobs/:id', (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json(job)
  })

  // ── DB Browser UI + data API ───────────────────────────────────────────
  const DB_TABLES = new Set(['sermons', 'chunks', 'jobs'])

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

  return app
}
