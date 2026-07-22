import { describe, it, expect, beforeEach, vi } from 'vitest'

// router.js pulls in scheduler.js -> ingestion/pipeline.js -> ingestion/embedder.js,
// which loads @xenova/transformers (and its native `sharp` dependency) at import
// time. None of these tests touch ingestion, so mock it out the same way
// tests/ingestion.test.ts does to avoid a hard crash in sandboxes where sharp's
// prebuilt binary can't be downloaded.
vi.mock('../src/ingestion/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Buffer.alloc(1536)),
  loadEmbedder: vi.fn(),
}))

import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  upsertSpeakerAlias,
  type SaveSermonInput,
} from '../src/db/queries.js'
import { runChatTool } from '../src/web/router.js'

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

describe('runChatTool — list_sermons', () => {
  it('returns the COMPLETE roster for a month, even sermons no keyword search would surface', () => {
    // The reported bug: enumerating a month via relevance search missed sermons.
    // list_sermons must return every sermon in the period regardless of content.
    saveSermon(sermon({ title: 'Solid Roots, Solid Fruits', date: '2023-03-01' }))
    saveSermon(sermon({ title: 'Lamp & Light', date: '2023-03-05' }))
    saveSermon(sermon({ title: 'God Logos', date: '2023-03-19' }))
    saveSermon(sermon({ title: 'Ideologies', date: '2023-03-26' }))
    saveSermon(sermon({ title: 'February Sermon', date: '2023-02-10' }))

    const { text } = runChatTool('list_sermons', { date: '2023-03' })

    expect(text).toContain('Solid Roots, Solid Fruits')
    expect(text).toContain('Lamp & Light')
    expect(text).toContain('God Logos')
    expect(text).toContain('Ideologies')
    expect(text).not.toContain('February Sermon')
    expect(text).toContain('4 sermon(s) matched')
  })

  it('reports sources for every matched sermon', () => {
    saveSermon(sermon({ title: 'A', date: '2023-03-01' }))
    saveSermon(sermon({ title: 'B', date: '2023-03-02' }))

    const { sources } = runChatTool('list_sermons', { date: '2023-03' })
    expect(sources.map((s) => s.title).sort()).toEqual(['A', 'B'])
  })

  it('filters by speaker', () => {
    saveSermon(sermon({ title: 'By Laju', date: '2023-03-01', speaker: 'Pst. Laju Iren' }))
    saveSermon(sermon({ title: 'By Other', date: '2023-03-02', speaker: 'Someone Else' }))

    const { text } = runChatTool('list_sermons', { speaker: 'Laju' })
    expect(text).toContain('By Laju')
    expect(text).not.toContain('By Other')
  })
})

describe('runChatTool — find_sermon', () => {
  it('returns the YouTube link for a sermon matched by title', () => {
    saveSermon(
      sermon({
        title: 'The Prodigal Son',
        date: '2023-04-02',
        speaker: 'Pst. Laju Iren',
        webpage_url: 'https://youtube.com/watch?v=abc123',
      })
    )
    saveSermon(sermon({ title: 'Something Else', date: '2023-04-09' }))

    const { text, sources } = runChatTool('find_sermon', { title: 'prodigal' })
    expect(text).toContain('The Prodigal Son')
    expect(text).toContain('YouTube: https://youtube.com/watch?v=abc123')
    expect(text).not.toContain('Something Else')
    expect(sources[0]).toMatchObject({ title: 'The Prodigal Son', date: '2023-04-02' })
  })

  it('says so when the matched sermon has no link on file', () => {
    saveSermon(sermon({ title: 'No Link Sermon', date: '2023-05-01' }))

    const { text } = runChatTool('find_sermon', { title: 'No Link' })
    expect(text).toContain('No Link Sermon')
    expect(text).toContain('YouTube: (no link on file)')
  })

  it('narrows by speaker', () => {
    saveSermon(
      sermon({ title: 'Grace', date: '2023-06-01', speaker: 'Pst. Laju Iren', webpage_url: 'https://youtu.be/laju' })
    )
    saveSermon(
      sermon({ title: 'Grace', date: '2023-06-08', speaker: 'Someone Else', webpage_url: 'https://youtu.be/other' })
    )

    const { text } = runChatTool('find_sermon', { title: 'grace', speaker: 'Laju' })
    expect(text).toContain('https://youtu.be/laju')
    expect(text).not.toContain('https://youtu.be/other')
  })

  it('resolves a speaker alias the same way list_sermons does (regression: find_sermon used to skip alias resolution)', () => {
    upsertSpeakerAlias('the apostle', 'Pst. Laju Iren')
    saveSermon(
      sermon({ title: 'Grace', date: '2023-06-01', speaker: 'Pst. Laju Iren', webpage_url: 'https://youtu.be/laju' })
    )
    saveSermon(
      sermon({ title: 'Grace', date: '2023-06-08', speaker: 'Someone Else', webpage_url: 'https://youtu.be/other' })
    )

    const { text } = runChatTool('find_sermon', { title: 'grace', speaker: 'the apostle' })
    expect(text).toContain('https://youtu.be/laju')
    expect(text).not.toContain('https://youtu.be/other')
  })

  it('reports no match when the title is unknown', () => {
    saveSermon(sermon({ title: 'Faith', date: '2023-07-01' }))

    const { text, sources } = runChatTool('find_sermon', { title: 'nonexistent topic' })
    expect(text).toContain('No sermon found')
    expect(sources).toHaveLength(0)
  })
})

describe('runChatTool — search_sermon_excerpts', () => {
  it('returns relevant excerpts with citations', () => {
    const id = saveSermon(sermon({ title: 'On Faith', date: '2023-03-01' }))
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'Faith is the substance of things hoped for.',
        timestamp_start: 0,
        timestamp_end: 60,
      },
    ])

    const { text, sources } = runChatTool('search_sermon_excerpts', { query: 'faith' })
    expect(text).toContain('On Faith')
    expect(sources[0]).toMatchObject({ title: 'On Faith', date: '2023-03-01' })
  })
})
