import { Hono } from 'hono'
import type Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { enqueue, getJob, getRecentJobs } from '../queue.js'
import { ingestSermon, type IngestRequest } from '../ingestion/pipeline.js'
import { adminHtml } from './adminHtml.js'

export function createRouter(anthropic: Anthropic): Hono {
  const app = new Hono()

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true }))

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

    if (!req.mp3Url || !req.title || !req.speaker || !req.date) {
      return c.json({ error: 'mp3Url, title, speaker, and date are required' }, 400)
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
