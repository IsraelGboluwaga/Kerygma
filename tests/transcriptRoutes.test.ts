import { describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { initDatabase } from '../src/db/connection.js'
import { saveSermon, insertTranscription, getSermonByVideoId } from '../src/db/queries.js'
import { createRouter } from '../src/web/router.js'

// Anthropic is only hit on the natural-language search path; these tests use the
// structured path and direct video-id lookups, so a throwing stub is fine.
const stubAnthropic = {
  messages: { create: async () => { throw new Error('should not be called') } },
} as unknown as Anthropic

function seed(): string {
  const videoId = 'seed-vid-0001'
  const id = saveSermon({
    video_id: videoId,
    title: 'Walking By Faith',
    date: '2023-02-12',
    download_url: 'https://example.com/a.mp3',
    speaker: 'Pastor John',
    excerpt: 'Trusting God in the unseen.',
    theme: { themeId: 't-faith', name: 'Faith' },
  })
  insertTranscription(
    id,
    'We begin with faith.\n\nFaith is trust.',
    JSON.stringify([
      { text: 'We begin with faith.', start: 0, duration: 3 },
      { text: 'Faith is trust.', start: 3, duration: 2 },
    ])
  )
  return videoId
}

describe('transcripts routes', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  it('GET /transcripts serves the page', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/transcripts')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Transcripts')
  })

  it('GET /transcripts/search (structured theme) returns matching rows', async () => {
    seed()
    const app = createRouter(stubAnthropic)
    const res = await app.request('/transcripts/search?theme=faith')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sermons).toHaveLength(1)
    expect(body.sermons[0].title).toBe('Walking By Faith')
    expect(body.sermons[0].hasTranscript).toBe(true)
    expect(body.sermons[0].dateFormatted).toBe('12 February 2023')
    expect(body.sermons[0].downloadUrl).toBe('/transcripts/seed-vid-0001/download')
  })

  it('GET /transcripts/search (structured date) filters by month/year', async () => {
    seed()
    const app = createRouter(stubAnthropic)
    const hit = await (await app.request('/transcripts/search?year=2023&month=02')).json()
    expect(hit.sermons).toHaveLength(1)
    const miss = await (await app.request('/transcripts/search?year=2024&month=01')).json()
    expect(miss.sermons).toHaveLength(0)
  })

  it('GET /transcripts/:videoId renders the transcript view', async () => {
    const videoId = seed()
    const app = createRouter(stubAnthropic)
    const res = await app.request(`/transcripts/${videoId}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Walking By Faith')
    expect(html).toContain('Faith is trust.')
  })

  it('GET /transcripts/:videoId/download streams a PDF', async () => {
    const videoId = seed()
    const app = createRouter(stubAnthropic)
    const res = await app.request(`/transcripts/${videoId}/download`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain(
      'faith__walking-by-faith__february-2023.pdf'
    )
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF')
  })

  it('GET /transcripts/:videoId returns 404 for an unknown id', async () => {
    const app = createRouter(stubAnthropic)
    const res = await app.request('/transcripts/does-not-exist')
    expect(res.status).toBe(404)
    // ensure "search" is not captured as a video id
    expect(getSermonByVideoId('search')).toBeNull()
  })
})
