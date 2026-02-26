import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { enqueue, getJob, getRecentJobs } from '../queue.js'
import { ingestSermon, type IngestRequest } from '../ingestion/pipeline.js'
import { searchChunks } from '../db/queries.js'
import { formatTimestamp } from '../ingestion/chunker.js'
import { adminHtml } from './adminHtml.js'
import { chatHtml } from './chatHtml.js'

export function createRouter(anthropic: Anthropic): Hono {
  const app = new Hono()

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true }))

  // ── Chat ───────────────────────────────────────────────────────────────
  app.get('/chat', (c) => c.html(chatHtml()))

  app.post('/chat', async (c) => {
    let body: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      systemPrompt?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { messages, systemPrompt: clientSystemPrompt } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400)
    }

    let systemPrompt = clientSystemPrompt
    let sources: Array<{ title: string; date: string; timestamp: string }> | undefined

    if (!systemPrompt) {
      const firstMessage = messages[0].content
      const chunks = searchChunks(firstMessage, 10)
      if (chunks.length === 0) {
        return c.json(
          { error: 'No sermons indexed yet. Ask an administrator to ingest some first.' },
          404
        )
      }

      sources = chunks.map((ch) => ({
        title: ch.sermon_title,
        date: ch.date,
        timestamp: formatTimestamp(ch.timestamp_start),
      }))

      const context = chunks
        .map(
          (ch) =>
            `[${ch.sermon_title} | ${ch.date} | ${formatTimestamp(ch.timestamp_start)}]\n${ch.content}`
        )
        .join('\n\n')

      systemPrompt = [
        'You are a helpful assistant for a church community.',
        'Answer questions based solely on the sermon excerpts below.',
        'Cite the sermon title, date, and timestamp when referencing specific content.',
        'If the question cannot be answered from the excerpts, say so clearly.',
        '',
        context,
      ].join('\n')
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    const resolvedPrompt = systemPrompt

    return stream(c, async (s) => {
      if (!clientSystemPrompt) {
        await s.write(
          `data: ${JSON.stringify({ type: 'context', systemPrompt: resolvedPrompt, sources })}\n\n`
        )
      }

      try {
        const msgStream = await anthropic.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: 2048,
          system: resolvedPrompt,
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
        const message = err instanceof Error ? err.message : 'Unknown error'
        await s.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
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

    const jobId = enqueue(() => ingestSermon(req, anthropic))
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

  return app
}
