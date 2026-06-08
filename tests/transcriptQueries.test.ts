import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  getSermonsByThemeName,
  searchSermons,
  type SaveSermonInput,
} from '../src/db/queries.js'

beforeEach(() => {
  initDatabase(':memory:')
})

function sermon(overrides: Partial<SaveSermonInput> = {}): SaveSermonInput {
  return {
    video_id: Math.random().toString(36).slice(2, 18),
    title: 'Untitled',
    date: '2023-02-10',
    download_url: 'https://example.com/a.mp3',
    ...overrides,
  }
}

describe('getSermonsByThemeName', () => {
  it('matches a theme name by substring, case-insensitively', () => {
    saveSermon(sermon({ title: 'A', theme: { themeId: 't1', name: 'Faith Foundations' } }))
    saveSermon(sermon({ title: 'B', theme: { themeId: 't2', name: 'Grace' } }))

    const rows = getSermonsByThemeName('faith')
    expect(rows.map((r) => r.title)).toEqual(['A'])
    expect(rows[0].theme).toBe('Faith Foundations')
  })

  it('returns nothing when no theme matches', () => {
    saveSermon(sermon({ theme: { themeId: 't1', name: 'Grace' } }))
    expect(getSermonsByThemeName('faith')).toEqual([])
  })
})

describe('searchSermons', () => {
  it('returns distinct sermons whose chunks match the query', () => {
    const id = saveSermon(sermon({ title: 'On Faith' }))
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'Today we talk about faith and trusting God deeply.',
        timestamp_start: 0,
        timestamp_end: 60,
      },
      {
        section_name: 'Point',
        content: 'Faith is the substance of things hoped for.',
        timestamp_start: 60,
        timestamp_end: 120,
      },
    ])
    const other = saveSermon(sermon({ title: 'On Money' }))
    saveChunks(other, [
      {
        section_name: 'Intro',
        content: 'Stewardship and generosity in giving.',
        timestamp_start: 0,
        timestamp_end: 60,
      },
    ])

    const rows = searchSermons('faith')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('On Faith')
  })
})
