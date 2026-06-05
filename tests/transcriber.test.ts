import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures these are available inside vi.mock factories
const { mockCreate, mockCreateReadStream, mockStatSync } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCreateReadStream: vi.fn(),
  mockStatSync: vi.fn(),
}))

// Use a regular function (not arrow) so `new OpenAI()` works
vi.mock('openai', () => {
  function MockOpenAI() {
    return {
      audio: { transcriptions: { create: mockCreate } },
    }
  }
  return { default: MockOpenAI }
})

vi.mock('node:fs', () => ({
  default: { createReadStream: mockCreateReadStream, statSync: mockStatSync },
  createReadStream: mockCreateReadStream,
  statSync: mockStatSync,
}))

import { transcribeAudio } from '../src/ingestion/transcriber.js'

const fakeVerboseResponse = {
  text: 'Hello church. Let us pray together today.',
  language: 'english',
  duration: 300,
  segments: [
    {
      id: 0, seek: 0, start: 0, end: 5,
      text: ' Hello church.',
      tokens: [], temperature: 0, avg_logprob: -0.3, compression_ratio: 1.2, no_speech_prob: 0.01,
    },
    {
      id: 1, seek: 500, start: 5, end: 12,
      text: ' Let us pray together today.',
      tokens: [], temperature: 0, avg_logprob: -0.3, compression_ratio: 1.2, no_speech_prob: 0.01,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue(fakeVerboseResponse)
  mockCreateReadStream.mockReturnValue({ pipe: vi.fn() })
  // Default: file is under the 25 MB limit
  mockStatSync.mockReturnValue({ size: 10 * 1024 * 1024 } as ReturnType<typeof import('node:fs').statSync>)
})

describe('transcribeAudio', () => {
  it('returns segments mapped from OpenAI verbose_json response', async () => {
    const result = await transcribeAudio('/tmp/test.mp3')

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ text: 'Hello church.', start: 0, duration: 5 })
    expect(result.segments[1]).toMatchObject({ text: 'Let us pray together today.', start: 5, duration: 7 })
  })

  it('returns the full plain-text transcript', async () => {
    const result = await transcribeAudio('/tmp/test.mp3')
    expect(result.transcript).toBe('Hello church. Let us pray together today.')
  })

  it('returns duration from response', async () => {
    const result = await transcribeAudio('/tmp/test.mp3')
    expect(result.duration).toBe(300)
  })

  it('falls back to last segment end time when duration is missing', async () => {
    mockCreate.mockResolvedValue({ ...fakeVerboseResponse, duration: undefined })
    const result = await transcribeAudio('/tmp/test.mp3')
    // last segment: start=5, end=12 → duration = 5 + (12-5) = 12
    expect(result.duration).toBe(12)
  })

  it('returns zero duration and empty segments when response has no segments', async () => {
    mockCreate.mockResolvedValue({ text: '', language: 'english', duration: undefined, segments: [] })
    const result = await transcribeAudio('/tmp/test.mp3')
    expect(result.segments).toHaveLength(0)
    expect(result.duration).toBe(0)
  })

  it('uses whisper-1 model, verbose_json format, and explicit timeout', async () => {
    await transcribeAudio('/tmp/test.mp3')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1', response_format: 'verbose_json' }),
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('creates a read stream for the given file path', async () => {
    await transcribeAudio('/tmp/sermon.mp3')
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/sermon.mp3')
  })

  it('throws a clear error when file exceeds the 25 MB Whisper API limit', async () => {
    mockStatSync.mockReturnValue({ size: 26 * 1024 * 1024 } as ReturnType<typeof import('node:fs').statSync>)
    await expect(transcribeAudio('/tmp/large.mp3')).rejects.toThrow('25 MB')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('passes through files exactly at the limit', async () => {
    mockStatSync.mockReturnValue({ size: 25 * 1024 * 1024 } as ReturnType<typeof import('node:fs').statSync>)
    const result = await transcribeAudio('/tmp/test.mp3')
    expect(result.transcript).toBeDefined()
  })

  it('trims whitespace from segment text', async () => {
    mockCreate.mockResolvedValue({
      ...fakeVerboseResponse,
      segments: [{ ...fakeVerboseResponse.segments[0], text: '  Hello church.  ' }],
    })
    const result = await transcribeAudio('/tmp/test.mp3')
    expect(result.segments[0].text).toBe('Hello church.')
  })
})
