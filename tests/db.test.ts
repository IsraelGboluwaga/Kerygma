import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  getSermonByVideoId,
  getSermonsByDate,
  getNearestSermonByDate,
  getSpeakersMatchingFilter,
  getChunksBySermonId,
  searchChunks,
  listSermons,
  type SaveSermonInput,
  type SaveChunkInput,
} from '../src/db/queries.js'

// Each test gets a fresh in-memory DB — initDatabase always sets the singleton
beforeEach(() => {
  initDatabase(':memory:')
})

function sampleSermon(overrides: Partial<SaveSermonInput> = {}): SaveSermonInput {
  return {
    video_id: 'abc123def456abcd',
    title: 'Sunday Service',
    date: '2024-03-10',
    url: 'https://example.com/sermon.mp3',
    speaker: 'Pastor Test',
    duration: 3600,
    ...overrides,
  }
}

function sampleChunks(): SaveChunkInput[] {
  return [
    {
      section_name: 'Introduction',
      content: 'Welcome to church today. We will talk about prayer.',
      timestamp_start: 0,
      timestamp_end: 120,
      topics: ['prayer', 'welcome'],
      summary: 'Pastor welcomes the congregation.',
    },
    {
      section_name: 'Main Teaching',
      content: 'Faith is the substance of things hoped for. Tithing is an act of obedience.',
      timestamp_start: 120,
      timestamp_end: 600,
      topics: ['faith', 'tithing'],
      summary: 'Teaching on faith and tithing.',
    },
  ]
}

describe('saveSermon / getSermonByVideoId', () => {
  it('saves a sermon and retrieves it by video_id', () => {
    const id = saveSermon(sampleSermon())
    expect(id).toBeGreaterThan(0)

    const row = getSermonByVideoId('abc123def456abcd')
    expect(row).not.toBeNull()
    expect(row!.title).toBe('Sunday Service')
    expect(row!.speaker).toBe('Pastor Test')
  })

  it('returns null for unknown video_id', () => {
    expect(getSermonByVideoId('notexist')).toBeNull()
  })

  it('rejects duplicate video_id', () => {
    saveSermon(sampleSermon())
    expect(() => saveSermon(sampleSermon())).toThrow()
  })
})

describe('saveChunks / getChunksBySermonId', () => {
  it('saves chunks and retrieves them in timestamp order', () => {
    const sid = saveSermon(sampleSermon())
    saveChunks(sid, sampleChunks())

    const chunks = getChunksBySermonId(sid)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].section_name).toBe('Introduction')
    expect(chunks[1].section_name).toBe('Main Teaching')
  })

  it('returns empty array for sermon with no chunks', () => {
    const sid = saveSermon(sampleSermon())
    expect(getChunksBySermonId(sid)).toHaveLength(0)
  })
})

describe('getSermonsByDate', () => {
  it('matches exact date', () => {
    saveSermon(sampleSermon())
    expect(getSermonsByDate('2024-03-10')).toHaveLength(1)
  })

  it('matches partial year-month', () => {
    saveSermon(sampleSermon())
    expect(getSermonsByDate('2024-03')).toHaveLength(1)
  })

  it('matches partial year', () => {
    saveSermon(sampleSermon())
    expect(getSermonsByDate('2024')).toHaveLength(1)
  })

  it('returns empty for non-matching date', () => {
    saveSermon(sampleSermon())
    expect(getSermonsByDate('2025')).toHaveLength(0)
  })
})

describe('searchChunks (FTS5)', () => {
  beforeEach(() => {
    const sid = saveSermon(sampleSermon())
    saveChunks(sid, sampleChunks())
  })

  it('finds chunk by content keyword', () => {
    const results = searchChunks('prayer')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some((r) => r.content.toLowerCase().includes('prayer'))).toBe(true)
  })

  it('finds chunk by topic keyword', () => {
    const results = searchChunks('tithing')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty for non-matching query', () => {
    expect(searchChunks('xyznonexistent')).toHaveLength(0)
  })

  it('attaches sermon metadata to results', () => {
    const results = searchChunks('faith')
    expect(results[0].sermon_title).toBe('Sunday Service')
    expect(results[0].date).toBe('2024-03-10')
    expect(results[0].speaker).toBe('Pastor Test')
  })
})

describe('getNearestSermonByDate', () => {
  it('returns null when no sermons exist', () => {
    expect(getNearestSermonByDate('2024-03-10')).toBeNull()
  })

  it('returns the only sermon when there is one', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-01-15' }))
    const nearest = getNearestSermonByDate('2024-06-01')
    expect(nearest).not.toBeNull()
    expect(nearest!.date).toBe('2024-01-15')
  })

  it('returns the closest sermon when multiple exist', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-01-01' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', date: '2024-03-20' }))
    const nearest = getNearestSermonByDate('2024-03-12')
    expect(nearest!.date).toBe('2024-03-20') // 8 days away vs 71 days
  })

  it('handles partial year-only date input', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-03-10' }))
    const nearest = getNearestSermonByDate('2025')
    expect(nearest).not.toBeNull()
  })
})

describe('getSpeakersMatchingFilter', () => {
  beforeEach(() => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', speaker: 'Apostle Emmanuel Iren' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', speaker: 'Apostle Kairos Iren', date: '2024-04-01' }))
    saveSermon(sampleSermon({ video_id: 'cccccccccccccccc', speaker: 'Pastor Seun', date: '2024-05-01' }))
  })

  it('returns all matching speakers for a broad filter', () => {
    const results = getSpeakersMatchingFilter('Apostle')
    expect(results).toHaveLength(2)
    expect(results).toContain('Apostle Emmanuel Iren')
    expect(results).toContain('Apostle Kairos Iren')
  })

  it('returns exactly one speaker for a specific filter', () => {
    const results = getSpeakersMatchingFilter('Emmanuel')
    expect(results).toHaveLength(1)
    expect(results[0]).toBe('Apostle Emmanuel Iren')
  })

  it('is case-insensitive', () => {
    expect(getSpeakersMatchingFilter('apostle')).toHaveLength(2)
    expect(getSpeakersMatchingFilter('PASTOR')).toHaveLength(1)
  })

  it('returns empty array when no speaker matches', () => {
    expect(getSpeakersMatchingFilter('Bishop')).toHaveLength(0)
  })
})

describe('listSermons', () => {
  it('returns sermons ordered by date descending', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-01-01' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', date: '2024-03-10' }))

    const rows = listSermons(10)
    expect(rows[0].date).toBe('2024-03-10')
    expect(rows[1].date).toBe('2024-01-01')
  })

  it('respects limit', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-01-01' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', date: '2024-03-10' }))

    expect(listSermons(1)).toHaveLength(1)
  })
})
