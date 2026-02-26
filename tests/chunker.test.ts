import { describe, it, expect } from 'vitest'
import {
  formatTimestamp,
  prepareTranscriptForChunking,
  validateChunks,
  type ChunkCandidate,
} from '../src/ingestion/chunker.js'
import type { TranscriptSegment } from '../src/ingestion/transcriber.js'

describe('formatTimestamp', () => {
  it('formats whole minutes', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(60)).toBe('01:00')
    expect(formatTimestamp(3600)).toBe('60:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatTimestamp(65)).toBe('01:05')
    expect(formatTimestamp(130.5)).toBe('02:10')
  })

  it('pads single digits', () => {
    expect(formatTimestamp(5)).toBe('00:05')
    expect(formatTimestamp(61)).toBe('01:01')
  })

  it('truncates sub-second precision', () => {
    expect(formatTimestamp(65.9)).toBe('01:05')
  })
})

describe('prepareTranscriptForChunking', () => {
  const segments: TranscriptSegment[] = [
    { text: 'Hello church.', start: 65.0, duration: 2.0 },
    { text: 'Let us pray.', start: 130.5, duration: 1.5 },
  ]

  it('formats each segment as [MM:SS] text', () => {
    const result = prepareTranscriptForChunking(segments)
    expect(result).toContain('[01:05] Hello church.')
    expect(result).toContain('[02:10] Let us pray.')
  })

  it('joins segments with newlines', () => {
    const result = prepareTranscriptForChunking(segments)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
  })

  it('returns empty string for empty transcript', () => {
    expect(prepareTranscriptForChunking([])).toBe('')
  })
})

describe('validateChunks', () => {
  function makeChunk(
    name: string,
    start: number,
    end: number
  ): ChunkCandidate {
    return {
      section_name: name,
      timestamp_start: start,
      timestamp_end: end,
      topics: [],
      summary: '',
      content: name,
    }
  }

  it('sorts chunks by start time', () => {
    const chunks = [makeChunk('B', 200, 300), makeChunk('A', 0, 100)]
    const result = validateChunks(chunks)
    expect(result[0].section_name).toBe('A')
    expect(result[1].section_name).toBe('B')
  })

  it('fills gaps between chunks', () => {
    const chunks = [makeChunk('A', 0, 100), makeChunk('B', 150, 300)]
    const result = validateChunks(chunks)
    expect(result[0].timestamp_end).toBe(150)
  })

  it('trims overlapping ends', () => {
    const chunks = [makeChunk('A', 0, 200), makeChunk('B', 150, 300)]
    const result = validateChunks(chunks)
    expect(result[0].timestamp_end).toBe(150)
  })

  it('leaves contiguous chunks unchanged', () => {
    const chunks = [makeChunk('A', 0, 100), makeChunk('B', 100, 200)]
    const result = validateChunks(chunks)
    expect(result[0].timestamp_end).toBe(100)
    expect(result[1].timestamp_start).toBe(100)
  })

  it('handles single chunk', () => {
    const chunks = [makeChunk('A', 0, 100)]
    const result = validateChunks(chunks)
    expect(result).toHaveLength(1)
    expect(result[0].timestamp_end).toBe(100)
  })
})
