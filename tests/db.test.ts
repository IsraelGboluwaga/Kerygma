import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  insertPartialSermon,
  insertTranscription,
  getTranscriptionBySermonId,
  completeSermon,
  saveChunks,
  getSermonByVideoId,
  getSermonsByDate,
  getNearestSermonByDate,
  getSpeakersMatchingFilter,
  getChunksBySermonId,
  searchChunks,
  listSermons,
  getSermonsByTheme,
  listThemes,
  recordMissingSermon,
  listMissingSermons,
  removeMissingSermon,
  resolveAliasToCanonical,
  upsertSpeakerAlias,
  deleteSpeakerAlias,
  listSpeakerAliases,
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
    download_url: 'https://example.com/sermon.mp3',
    speaker: 'Pastor Test',
    duration: 3600,
    theme: { themeId: 'theme-faith', name: 'Faith Foundations', slug: 'faith-foundations' },
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
    expect(results[0].theme).toBe('Faith Foundations')
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

  it('returns all matching speakers for a broad LIKE filter', () => {
    // 'Iren' is not an alias — falls through to LIKE and matches both
    const results = getSpeakersMatchingFilter('Iren')
    expect(results).toHaveLength(2)
    expect(results).toContain('Apostle Emmanuel Iren')
    expect(results).toContain('Apostle Kairos Iren')
  })

  it('returns exactly one speaker for a specific filter', () => {
    const results = getSpeakersMatchingFilter('Emmanuel')
    expect(results).toHaveLength(1)
    expect(results[0]).toBe('Apostle Emmanuel Iren')
  })

  it('is case-insensitive for LIKE fallback', () => {
    expect(getSpeakersMatchingFilter('iren')).toHaveLength(2)
    expect(getSpeakersMatchingFilter('PASTOR')).toHaveLength(1)
  })

  it('returns empty array when no speaker matches', () => {
    expect(getSpeakersMatchingFilter('Bishop')).toHaveLength(0)
  })

  it('resolves an alias and narrows to the canonical speaker', () => {
    // 'pastey' is an alias for 'Apostle Emmanuel Iren'
    const results = getSpeakersMatchingFilter('pastey')
    expect(results).toHaveLength(1)
    expect(results[0]).toBe('Apostle Emmanuel Iren')
  })

  it('alias lookup is case-insensitive', () => {
    expect(getSpeakersMatchingFilter('PIE')).toHaveLength(1)
    expect(getSpeakersMatchingFilter('Pie')).toHaveLength(1)
  })

  it('alias overrides broad LIKE — apostle resolves to one speaker', () => {
    // 'apostle' is seeded as an alias for Apostle Emmanuel Iren, so it returns
    // only that speaker even though two speakers contain the word "apostle".
    const results = getSpeakersMatchingFilter('apostle')
    expect(results).toHaveLength(1)
    expect(results[0]).toBe('Apostle Emmanuel Iren')
  })
})

describe('resolveAliasToCanonical', () => {
  it('returns the canonical name for a known alias', () => {
    expect(resolveAliasToCanonical('pastey')).toBe('Apostle Emmanuel Iren')
    expect(resolveAliasToCanonical('pie')).toBe('Apostle Emmanuel Iren')
    expect(resolveAliasToCanonical('a-z l')).toBe('Pastor Laju')
    expect(resolveAliasToCanonical('pl')).toBe('Pastor Laju')
  })

  it('is case-insensitive', () => {
    expect(resolveAliasToCanonical('PIE')).toBe('Apostle Emmanuel Iren')
    expect(resolveAliasToCanonical('Pastey')).toBe('Apostle Emmanuel Iren')
    expect(resolveAliasToCanonical('PL')).toBe('Pastor Laju')
  })

  it('returns null for an unknown term', () => {
    expect(resolveAliasToCanonical('bishop')).toBeNull()
    expect(resolveAliasToCanonical('')).toBeNull()
  })
})

describe('upsertSpeakerAlias / deleteSpeakerAlias / listSpeakerAliases', () => {
  it('upsert adds a new alias', () => {
    upsertSpeakerAlias('dr john', 'Dr. John Smith')
    expect(resolveAliasToCanonical('dr john')).toBe('Dr. John Smith')
  })

  it('upsert overwrites an existing alias', () => {
    upsertSpeakerAlias('pastey', 'New Canonical')
    expect(resolveAliasToCanonical('pastey')).toBe('New Canonical')
  })

  it('upsert stores alias lowercased regardless of input case', () => {
    upsertSpeakerAlias('DR JOHN', 'Dr. John Smith')
    expect(resolveAliasToCanonical('dr john')).toBe('Dr. John Smith')
  })

  it('delete removes an alias', () => {
    upsertSpeakerAlias('temp', 'Someone')
    deleteSpeakerAlias('temp')
    expect(resolveAliasToCanonical('temp')).toBeNull()
  })

  it('listSpeakerAliases returns all aliases ordered by canonical then alias', () => {
    const all = listSpeakerAliases()
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((a) => a.alias === a.alias.toLowerCase())).toBe(true)
    const pie = all.find((a) => a.alias === 'pie')
    expect(pie?.canonicalName).toBe('Apostle Emmanuel Iren')
  })
})

describe('insertPartialSermon / completeSermon / insertTranscription', () => {
  it('partial sermon is not returned by listSermons until completed', () => {
    insertPartialSermon({ ...sampleSermon(), duration: 3600 })
    expect(listSermons(10)).toHaveLength(0)
  })

  it('completeSermon makes it visible and sets status to done', () => {
    const id = insertPartialSermon({ ...sampleSermon(), duration: 3600 })
    completeSermon(id)
    const rows = listSermons(10)
    expect(rows).toHaveLength(1)
    expect(rows[0].ingestion_status).toBe('done')
    expect(rows[0].transcription).toBeNull()
  })

  it('partial record is retrievable by video_id for retry', () => {
    const id = insertPartialSermon({ ...sampleSermon(), duration: 3600 })
    const row = getSermonByVideoId('abc123def456abcd')
    expect(row).not.toBeNull()
    expect(row!.ingestion_status).toBe('transcribed')

    // Transcription is stored in the transcriptions table, not on the sermon row
    insertTranscription(id, 'Hello church.', '[{"text":"Hello church.","start":0,"duration":2}]')
    const t = getTranscriptionBySermonId(id)
    expect(t).not.toBeNull()
    expect(t!.transcript).toBe('Hello church.')
    expect(JSON.parse(t!.segments)).toHaveLength(1)
  })

  it('description is stored and retrievable', () => {
    const id = saveSermon({ ...sampleSermon(), description: 'A sermon about faith.' })
    const row = getSermonByVideoId('abc123def456abcd')
    expect(row!.description).toBe('A sermon about faith.')
  })

  it('excerpt is stored and retrievable', () => {
    saveSermon({ ...sampleSermon(), excerpt: 'A short summary of the sermon.' })
    const row = getSermonByVideoId('abc123def456abcd')
    expect(row!.excerpt).toBe('A short summary of the sermon.')
  })
})

describe('themes', () => {
  it('attaches the theme name to a saved sermon', () => {
    saveSermon(sampleSermon())
    const row = getSermonByVideoId('abc123def456abcd')
    expect(row!.theme).toBe('Faith Foundations')
    expect(row!.theme_id).toBeGreaterThan(0)
  })

  it('reuses one themes row across sermons sharing a theme_id', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', date: '2024-04-01' }))
    expect(listThemes()).toHaveLength(1)
  })

  it('updates the theme name on re-save but keeps the same theme_id mapping', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa' }))
    saveSermon(
      sampleSermon({
        video_id: 'bbbbbbbbbbbbbbbb',
        date: '2024-04-01',
        theme: { themeId: 'theme-faith', name: 'Renamed Theme', slug: 'faith-foundations' },
      })
    )
    const themes = listThemes()
    expect(themes).toHaveLength(1)
    expect(themes[0].name).toBe('Renamed Theme')
  })

  it('fetches all sermons for a theme by upstream theme_id', () => {
    saveSermon(sampleSermon({ video_id: 'aaaaaaaaaaaaaaaa', date: '2024-01-01' }))
    saveSermon(sampleSermon({ video_id: 'bbbbbbbbbbbbbbbb', date: '2024-03-10' }))
    saveSermon(
      sampleSermon({
        video_id: 'cccccccccccccccc',
        date: '2024-05-01',
        theme: { themeId: 'theme-other', name: 'Other Theme' },
      })
    )

    const faithSermons = getSermonsByTheme('theme-faith')
    expect(faithSermons).toHaveLength(2)
    expect(faithSermons[0].date).toBe('2024-03-10') // date DESC
  })

  it('returns null theme when a sermon has none', () => {
    saveSermon(sampleSermon({ theme: undefined }))
    const row = getSermonByVideoId('abc123def456abcd')
    expect(row!.theme).toBeNull()
    expect(row!.theme_id).toBeNull()
  })
})

describe('missing sermons', () => {
  it('records a failed sermon and lists it', () => {
    recordMissingSermon({
      video_id: 'vid-no-audio',
      title: 'No Audio Sermon',
      date: '2024-03-10',
      download_url: 'https://media.example.org/audio',
      webpage_url: 'https://youtu.be/abc',
      speaker: 'Pastor Test',
      theme: 'Faith Foundations',
      kind: 'no_audio',
      reason: 'No audio — download_url has no file path',
    })

    const rows = listMissingSermons()
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('No Audio Sermon')
    expect(rows[0].kind).toBe('no_audio')
    expect(rows[0].theme).toBe('Faith Foundations')
  })

  it('upserts on the same video_id instead of duplicating', () => {
    recordMissingSermon({ video_id: 'vid-1', title: 'A', kind: 'timeout', reason: 'first' })
    recordMissingSermon({ video_id: 'vid-1', title: 'A', kind: 'error', reason: 'second' })

    const rows = listMissingSermons()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('error')
    expect(rows[0].reason).toBe('second')
  })

  it('removes a missing sermon once resolved', () => {
    recordMissingSermon({ video_id: 'vid-1', title: 'A', kind: 'error', reason: 'x' })
    recordMissingSermon({ video_id: 'vid-2', title: 'B', kind: 'error', reason: 'y' })
    removeMissingSermon('vid-1')

    const rows = listMissingSermons()
    expect(rows).toHaveLength(1)
    expect(rows[0].video_id).toBe('vid-2')
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
