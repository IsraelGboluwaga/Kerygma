import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'

// Mock node-cron before imports
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
  schedule: vi.fn(),
}))

vi.mock('../src/ingestion/api-source.js', () => ({
  fetchAllSermons: vi.fn(),
}))

vi.mock('../src/ingestion/pipeline.js', () => ({
  ingestSermon: vi.fn(),
}))

vi.mock('../src/queue.js', () => ({
  enqueue: vi.fn().mockReturnValue('job-id-1'),
  getQueueDepth: vi.fn().mockReturnValue(0),
}))

import cron from 'node-cron'
import Anthropic from '@anthropic-ai/sdk'
import { fetchAllSermons } from '../src/ingestion/api-source.js'
import { ingestSermon } from '../src/ingestion/pipeline.js'
import { enqueue, getQueueDepth } from '../src/queue.js'
import { syncFromApi, startScheduler } from '../src/scheduler.js'

const mockFetchAllSermons = vi.mocked(fetchAllSermons)
const mockIngestSermon = vi.mocked(ingestSermon)
const mockEnqueue = vi.mocked(enqueue)
const mockGetQueueDepth = vi.mocked(getQueueDepth)
const fakeAnthropicClient = {} as Anthropic

function makeAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
  return (async function* () {
    for (const item of items) yield item
  })()
}

const fakeReq = {
  videoId: 'new-sermon-id',
  downloadUrl: 'https://api.example.com/audio/new.mp3',
  title: 'New Sermon',
  speaker: 'Pastor Test',
  date: '2024-06-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  initDatabase(':memory:')
  mockGetQueueDepth.mockReturnValue(0)
})

describe('syncFromApi', () => {
  it('enqueues new sermons from the API', async () => {
    mockFetchAllSermons.mockReturnValue(makeAsyncGenerator([fakeReq]))

    await syncFromApi(fakeAnthropicClient)

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ title: 'New Sermon', downloadUrl: fakeReq.downloadUrl })
    )
  })

  it('skips sermons that are already ingested', async () => {
    // Pre-insert the sermon so it's detected as existing
    const db = await import('../src/db/connection.js').then((m) => m.getDb())
    db.prepare(`INSERT INTO sermons (video_id, title, date, download_url, speaker, ingestion_status)
                VALUES (?, ?, ?, ?, ?, 'done')`).run(
      'new-sermon-id', 'New Sermon', '2024-06-01', fakeReq.downloadUrl, 'Pastor Test'
    )

    mockFetchAllSermons.mockReturnValue(makeAsyncGenerator([fakeReq]))

    await syncFromApi(fakeAnthropicClient)

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('stops enqueueing when queue is full', async () => {
    mockGetQueueDepth.mockReturnValue(500)
    const sermons = Array.from({ length: 5 }, (_, i) => ({
      ...fakeReq,
      videoId: `id-${i}`,
      title: `Sermon ${i}`,
    }))
    mockFetchAllSermons.mockReturnValue(makeAsyncGenerator(sermons))

    await syncFromApi(fakeAnthropicClient)

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('handles API errors gracefully without throwing', async () => {
    mockFetchAllSermons.mockReturnValue(
      (async function* () { throw new Error('Network failure') })()
    )

    await expect(syncFromApi(fakeAnthropicClient)).resolves.not.toThrow()
  })

  it('enqueues sermons that have no videoId via URL-based dedup', async () => {
    const reqWithoutId = { ...fakeReq, videoId: undefined }
    mockFetchAllSermons.mockReturnValue(makeAsyncGenerator([reqWithoutId]))

    await syncFromApi(fakeAnthropicClient)

    // No videoId means no existing-sermon check → should enqueue
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })
})

describe('startScheduler', () => {
  it('registers a cron job for Mon + Thu at 06:00', () => {
    startScheduler(fakeAnthropicClient)

    expect(cron.schedule).toHaveBeenCalledWith(
      '0 6 * * 1,4',
      expect.any(Function)
    )
  })
})
