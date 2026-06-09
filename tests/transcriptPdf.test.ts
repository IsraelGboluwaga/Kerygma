import { describe, it, expect } from 'vitest'
import { generateTranscriptPdf, transcriptPdfFilename } from '../src/web/transcriptPdf.js'
import type { SermonRow } from '../src/db/queries.js'

function sermon(overrides: Partial<SermonRow> = {}): SermonRow {
  return {
    id: 1,
    video_id: 'vid123',
    title: 'Walking By Faith',
    date: '2021-07-04',
    download_url: 'https://example.com/a.mp3',
    webpage_url: null,
    speaker: 'Pastor John',
    duration: 3600,
    tags: null,
    excerpt: 'A message on trusting God.',
    theme_id: 2,
    theme: 'Faith',
    description: null,
    ingestion_status: 'done',
    transcription: null,
    created_at: '2021-07-05T00:00:00Z',
    ...overrides,
  }
}

describe('transcriptPdfFilename', () => {
  it('builds theme__title__month-year.pdf', () => {
    expect(transcriptPdfFilename(sermon())).toBe('faith__walking-by-faith__july-2021.pdf')
  })

  it('falls back to "sermon" when no theme', () => {
    expect(transcriptPdfFilename(sermon({ theme: null }))).toBe(
      'sermon__walking-by-faith__july-2021.pdf'
    )
  })
})

describe('generateTranscriptPdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const pdf = await generateTranscriptPdf(sermon(), 'First paragraph.\n\nSecond paragraph.')
    expect(pdf.length).toBeGreaterThan(0)
    // PDF files start with the "%PDF" magic header
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF')
  })

  it('handles an empty transcript without throwing', async () => {
    const pdf = await generateTranscriptPdf(sermon(), '')
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF')
  })
})
