import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  getSermonsByThemeName,
  searchSermons,
  searchSermonsByTopic,
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

describe('searchSermonsByTopic', () => {
  it('returns only sermons whose section topics/summary are about the term', () => {
    // A: faith is a section topic + in the summary → genuinely about faith.
    const about = saveSermon(sermon({ title: 'Geared To Faith' }))
    saveChunks(about, [
      {
        section_name: 'Intro',
        content: 'Some opening words about the week.',
        topics: ['faith', 'trust'],
        summary: 'Building faith in hard seasons.',
        timestamp_start: 0,
        timestamp_end: 60,
      },
    ])

    // B: "faith" appears only in raw content, never as a topic/summary → incidental.
    const incidental = saveSermon(sermon({ title: 'Mostly Money' }))
    saveChunks(incidental, [
      {
        section_name: 'Intro',
        content: 'He kept the faith while teaching about budgeting.',
        topics: ['money', 'stewardship'],
        summary: 'Practical tips on giving.',
        timestamp_start: 0,
        timestamp_end: 60,
      },
    ])

    const rows = searchSermonsByTopic('faith')
    expect(rows.map((r) => r.title)).toEqual(['Geared To Faith'])
  })

  it('ranks by relevance density (more on-topic sermons first)', () => {
    // Dense: both sections about faith.
    const dense = saveSermon(sermon({ title: 'All Faith' }))
    saveChunks(dense, [
      { section_name: 'A', content: 'x', topics: ['faith'], summary: 'faith', timestamp_start: 0, timestamp_end: 30 },
      { section_name: 'B', content: 'y', topics: ['faith'], summary: 'faith', timestamp_start: 30, timestamp_end: 60 },
    ])
    // Sparse: only one of four sections about faith.
    const sparse = saveSermon(sermon({ title: 'A Bit Of Faith' }))
    saveChunks(sparse, [
      { section_name: 'A', content: 'x', topics: ['faith'], summary: 'faith', timestamp_start: 0, timestamp_end: 30 },
      { section_name: 'B', content: 'y', topics: ['hope'], summary: 'hope', timestamp_start: 30, timestamp_end: 60 },
      { section_name: 'C', content: 'z', topics: ['love'], summary: 'love', timestamp_start: 60, timestamp_end: 90 },
      { section_name: 'D', content: 'w', topics: ['grace'], summary: 'grace', timestamp_start: 90, timestamp_end: 120 },
    ])

    const rows = searchSermonsByTopic('faith')
    expect(rows.map((r) => r.title)).toEqual(['All Faith', 'A Bit Of Faith'])
  })

  it('returns nothing for a term that is never a topic', () => {
    const id = saveSermon(sermon({ title: 'Money' }))
    saveChunks(id, [
      { section_name: 'A', content: 'faith faith faith', topics: ['money'], summary: 'giving', timestamp_start: 0, timestamp_end: 30 },
    ])
    expect(searchSermonsByTopic('faith')).toEqual([])
  })
})
