import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'
import { enqueue, getJob, getRecentJobs, getQueueDepth, getQueuePosition } from '../queue.js'
import { ingestSermon, type IngestRequest } from '../ingestion/pipeline.js'
import { searchChunks } from '../db/queries.js'
import { formatTimestamp } from '../ingestion/chunker.js'
import { errMsg } from '../utils.js'
import { logger } from '../logger.js'
import { adminHtml } from './adminHtml.js'
import { statusHtml } from './statusHtml.js'
import { chatHtml } from './chatHtml.js'

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

  // Live status dashboard — page is public HTML (prompts for secret client-side),
  // the data endpoint behind it is protected.
  app.get('/admin/status', (c) => {
    return c.html(statusHtml())
  })

  app.use('/admin/ingest', adminMiddleware)
  app.use('/admin/jobs', adminMiddleware)
  app.use('/admin/jobs/:id', adminMiddleware)
  app.use('/admin/status/data', adminMiddleware)

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

    const jobId = enqueue((ctx) => ingestSermon(req, anthropic, ctx.setPhase), {
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
