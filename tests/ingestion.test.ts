import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'

// ── Mock heavy dependencies before any imports resolve them ────────────────

vi.mock('../src/ingestion/downloader.js', () => ({
  downloadMp3: vi.fn(),
}))

vi.mock('../src/ingestion/transcriber.js', () => ({
  transcribeAudio: vi.fn(),
}))

vi.mock('../src/ingestion/chunker.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ingestion/chunker.js')>()
  return {
    ...real,
    chunkSermon: vi.fn(),
  }
})

vi.mock('../src/ingestion/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Buffer.alloc(1536)),
  loadEmbedder: vi.fn(),
}))

import { downloadMp3 } from '../src/ingestion/downloader.js'
import { transcribeAudio } from '../src/ingestion/transcriber.js'
import { chunkSermon } from '../src/ingestion/chunker.js'
import { ingestSermon, type IngestRequest } from '../src/ingestion/pipeline.js'
import Anthropic from '@anthropic-ai/sdk'

const mockDownload = vi.mocked(downloadMp3)
const mockTranscribe = vi.mocked(transcribeAudio)
const mockChunk = vi.mocked(chunkSermon)

const fakeAnthropicClient = {} as Anthropic

const baseRequest: IngestRequest = {
  mp3Url: 'https://example.com/sermon.mp3',
  title: 'Sunday Service',
  speaker: 'Pastor Test',
  date: '2024-03-10',
}

const fakeSegments = [
  { text: 'Hello church.', start: 0, duration: 2 },
  { text: 'Let us pray.', start: 2, duration: 2 },
]

const fakeChunks = [
  {
    section_name: 'Introduction',
    content: 'Hello church. Let us pray.',
    timestamp_start: 0,
    timestamp_end: 120,
    topics: ['prayer'],
    summary: 'Opening.',
  },
]

beforeEach(() => {
  // Fresh in-memory DB for each test
  initDatabase(':memory:')

  // Default happy-path mocks
  const cleanup = vi.fn()
  mockDownload.mockResolvedValue({ filePath: '/tmp/test.mp3', cleanup })
  mockTranscribe.mockResolvedValue({ segments: fakeSegments, duration: 300 })
  mockChunk.mockResolvedValue(fakeChunks)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ingestSermon — happy path', () => {
  it('returns status ok with sermonId', async () => {
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('ok')
    expect(result.sermonId).toBeGreaterThan(0)
    expect(result.message).toContain('Sunday Service')
  })

  it('always calls cleanup even on success', async () => {
    const cleanup = vi.fn()
    mockDownload.mockResolvedValue({ filePath: '/tmp/test.mp3', cleanup })
    await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('ingestSermon — duplicate detection', () => {
  it('returns status duplicate on second ingest of same URL', async () => {
    await ingestSermon(baseRequest, fakeAnthropicClient)
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('duplicate')
    expect(result.message).toContain('Already ingested')
  })

  it('does not download on duplicate', async () => {
    await ingestSermon(baseRequest, fakeAnthropicClient)
    await ingestSermon(baseRequest, fakeAnthropicClient)
    // download called only once (first ingest)
    expect(mockDownload).toHaveBeenCalledTimes(1)
  })
})

describe('ingestSermon — duration limit', () => {
  it('returns status too_long when duration exceeds limit', async () => {
    // Default MAX_AUDIO_DURATION_SECONDS is 7200
    mockTranscribe.mockResolvedValue({ segments: fakeSegments, duration: 7201 })
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('too_long')
    expect(result.message).toContain('exceeds')
  })

  it('calls cleanup even when too long', async () => {
    const cleanup = vi.fn()
    mockDownload.mockResolvedValue({ filePath: '/tmp/test.mp3', cleanup })
    mockTranscribe.mockResolvedValue({ segments: [], duration: 9999 })
    await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('passes at exact duration limit', async () => {
    mockTranscribe.mockResolvedValue({ segments: fakeSegments, duration: 7200 })
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('ok')
  })
})

describe('ingestSermon — error paths', () => {
  it('returns status error when download fails', async () => {
    mockDownload.mockRejectedValue(new Error('Network error'))
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('error')
    expect(result.message).toContain('Network error')
  })

  it('returns status error when transcription fails', async () => {
    const cleanup = vi.fn()
    mockDownload.mockResolvedValue({ filePath: '/tmp/test.mp3', cleanup })
    mockTranscribe.mockRejectedValue(new Error('Whisper crashed'))
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('error')
    expect(result.message).toContain('Whisper crashed')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('returns status error when chunking fails', async () => {
    const cleanup = vi.fn()
    mockDownload.mockResolvedValue({ filePath: '/tmp/test.mp3', cleanup })
    mockChunk.mockRejectedValue(new Error('Claude API error'))
    const result = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result.status).toBe('error')
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('ingestSermon — video_id stability', () => {
  it('generates the same video_id for the same URL', async () => {
    const result1 = await ingestSermon(baseRequest, fakeAnthropicClient)
    expect(result1.status).toBe('ok')

    // Different title, same URL → should be detected as duplicate
    const result2 = await ingestSermon(
      { ...baseRequest, title: 'Different Title' },
      fakeAnthropicClient
    )
    expect(result2.status).toBe('duplicate')
  })
})
