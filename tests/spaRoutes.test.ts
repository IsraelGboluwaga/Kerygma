import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type Anthropic from '@anthropic-ai/sdk'
import { initDatabase } from '../src/db/connection.js'
import { createRouter } from '../src/web/router.js'

const stubAnthropic = {
  messages: { create: async () => { throw new Error('should not be called') } },
} as unknown as Anthropic

const SPA_INDEX = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'public',
  'app',
  'index.html'
)

describe('SPA + API routing', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  it('health endpoint stays JSON', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('protected admin data API rejects without the secret', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/api/admin/status')
    expect(res.status).toBe(401)
  })

  it('protected db API rejects without the secret', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/api/db/sermons')
    expect(res.status).toBe(401)
  })

  it('admin data API passes with the correct secret', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/api/admin/status', {
      headers: { 'X-Admin-Secret': 'test-secret' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('sermonCount')
  })

  it('serves the SPA shell for a client-side route', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/admin')
    if (existsSync(SPA_INDEX)) {
      // Build present (yarn build:web has run) — catch-all returns index.html.
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(await res.text()).toContain('id="root"')
    } else {
      // No build — catch-all reports the missing build rather than 500-ing.
      expect(res.status).toBe(404)
    }
  })
})
