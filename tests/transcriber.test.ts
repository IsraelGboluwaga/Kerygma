import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures these are available inside vi.mock factories
const { mockCreate, mockCreateReadStream, mockStatSync, mockExecFileSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCreateReadStream: vi.fn(),
  mockStatSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
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
  default: {
    createReadStream: mockCreateReadStream,
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
  },
  createReadStream: mockCreateReadStream,
  statSync: mockStatSync,
  unlinkSync: mockUnlinkSync,
}))

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

import { transcribeAudio } from '../src/ingestion/transcriber.js'

const UNDER_LIMIT = { size: 10 * 1024 * 1024 }   // 10 MB
const OVER_LIMIT  = { size: 64 * 1024 * 1024 }    // 64 MB
const JUST_AT_LIMIT = { size: 25 * 1024 * 1024 }  // 25 MB exactly
const STILL_TOO_BIG = { size: 26 * 1024 * 1024 }  // compressed but still over

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
  mockStatSync.mockReturnValue(UNDER_LIMIT as ReturnType<typeof import('node:fs').statSync>)
  // compressAudio calls statSync again on the output file to get compressed size
  // (first call = original, second call = compressed)
})

describe('transcribeAudio — happy path', () => {
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
    expect(result.duration).toBe(12) // start=5 + (end=12 - start=5) = 12
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

  it('uploads file directly when under the 25 MB limit', async () => {
    await transcribeAudio('/tmp/sermon.mp3')
    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(mockCreateReadStream).toHaveBeenCalledWith('/tmp/sermon.mp3')
  })

  it('passes through files exactly at the 25 MB limit without compressing', async () => {
    mockStatSync.mockReturnValue(JUST_AT_LIMIT as ReturnType<typeof import('node:fs').statSync>)
    await transcribeAudio('/tmp/test.mp3')
    expect(mockExecFileSync).not.toHaveBeenCalled()
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

describe('transcribeAudio — large file compression', () => {
  beforeEach(() => {
    // First statSync call = original file (over limit); second = compressed output (under limit)
    mockStatSync
      .mockReturnValueOnce(OVER_LIMIT as ReturnType<typeof import('node:fs').statSync>)
      .mockReturnValue({ size: 14 * 1024 * 1024 } as ReturnType<typeof import('node:fs').statSync>)
  })

  it('invokes ffmpeg to compress when original file exceeds 25 MB', async () => {
    await transcribeAudio('/tmp/large.mp3')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-i', '/tmp/large.mp3'])
    )
  })

  it('uses 16 kHz mono 24 kbps compression settings', async () => {
    await transcribeAudio('/tmp/large.mp3')
    const args = mockExecFileSync.mock.calls[0][1] as string[]
    expect(args).toContain('-ar')
    expect(args).toContain('16000')
    expect(args).toContain('-ac')
    expect(args).toContain('1')
    expect(args).toContain('-b:a')
    expect(args).toContain('24k')
  })

  it('uploads the compressed file, not the original', async () => {
    await transcribeAudio('/tmp/large.mp3')
    const streamArg = mockCreateReadStream.mock.calls[0][0] as string
    expect(streamArg).not.toBe('/tmp/large.mp3')
    expect(streamArg).toMatch(/kerygma-compressed-/)
  })

  it('cleans up the compressed temp file after transcription', async () => {
    await transcribeAudio('/tmp/large.mp3')
    const compressedPath = mockCreateReadStream.mock.calls[0][0] as string
    expect(mockUnlinkSync).toHaveBeenCalledWith(compressedPath)
  })

  it('cleans up compressed file even when transcription API throws', async () => {
    mockCreate.mockRejectedValue(new Error('API error'))
    await expect(transcribeAudio('/tmp/large.mp3')).rejects.toThrow('API error')
    const compressedPath = mockCreateReadStream.mock.calls[0][0] as string
    expect(mockUnlinkSync).toHaveBeenCalledWith(compressedPath)
  })

  it('throws a clear error when compressed file is still over 25 MB', async () => {
    mockStatSync
      .mockReturnValueOnce(OVER_LIMIT as ReturnType<typeof import('node:fs').statSync>)
      .mockReturnValue(STILL_TOO_BIG as ReturnType<typeof import('node:fs').statSync>)
    await expect(transcribeAudio('/tmp/enormous.mp3')).rejects.toThrow('25 MB')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('wraps ffmpeg errors with a helpful message', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('ffmpeg not found') })
    mockStatSync.mockReturnValue(OVER_LIMIT as ReturnType<typeof import('node:fs').statSync>)
    await expect(transcribeAudio('/tmp/large.mp3')).rejects.toThrow('Audio compression failed')
  })
})
