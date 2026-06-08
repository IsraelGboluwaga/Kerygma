import { describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  insertTranscription,
  getSermonByVideoId,
} from '../src/db/queries.js'
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
  saveChunks(id, [
    {
      section_name: 'Intro',
      content: 'We begin with faith.',
      topics: ['faith', 'trust'],
      summary: 'An exhortation to walk by faith.',
      timestamp_start: 0,
      timestamp_end: 3,
    },
  ])
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

  it('GET /transcripts/search (topic) returns sermons about the subject', async () => {
    seed()
    // A sermon that merely mentions "faith" in content but is not about it.
    const id = saveSermon({
      video_id: 'money-vid',
      title: 'On Money',
      date: '2023-03-01',
      download_url: 'https://example.com/m.mp3',
    })
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'He kept the faith while budgeting.',
        topics: ['money'],
        summary: 'Giving wisely.',
        timestamp_start: 0,
        timestamp_end: 5,
      },
    ])

    const app = createRouter(stubAnthropic)
    const body = await (await app.request('/transcripts/search?topic=faith')).json()
    expect(body.sermons.map((s: { title: string }) => s.title)).toEqual(['Walking By Faith'])
    expect(body.interpreted).toContain('about')
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
