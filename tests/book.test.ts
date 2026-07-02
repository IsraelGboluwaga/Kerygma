import { describe, it, expect, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { initDatabase } from '../src/db/connection.js'
import {
  saveSermon,
  saveChunks,
  insertBook,
  getBook,
  getBookChapters,
  type SaveSermonInput,
} from '../src/db/queries.js'
import { generateBook } from '../src/book/generator.js'
import type { JobContext } from '../src/queue.js'

beforeEach(() => {
  initDatabase(':memory:')
})

const ctx: JobContext = { setPhase: () => {} }

function sermon(overrides: Partial<SaveSermonInput> = {}): SaveSermonInput {
  return {
    video_id: Math.random().toString(36).slice(2, 18),
    title: 'On Hope',
    date: '2023-02-10',
    download_url: 'https://example.com/a.mp3',
    ...overrides,
  }
}

// Mock Anthropic: the forced-tool outline call (has tool_choice) returns an
// emit_outline tool_use; chapter-drafting calls (no tool_choice) return text.
function fakeAnthropic(): Anthropic {
  return {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async (args: any) => {
        if (args.tool_choice) {
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                name: 'emit_outline',
                input: {
                  title: 'A Book on Hope',
                  chapters: [
                    { heading: 'The Ground of Hope', focus: 'Why we hope', sermon_ids: [1] },
                    { heading: 'Hope in Practice', focus: 'Living it out', sermon_ids: [1] },
                  ],
                },
              },
            ],
          }
        }
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'A drafted chapter grounded in the sermon. (On Hope, 10 February 2023)' }],
        }
      },
    },
  } as unknown as Anthropic
}

describe('generateBook', () => {
  it('retrieves a corpus, drafts chapters, and marks the book done', async () => {
    const id = saveSermon(sermon({ theme: { themeId: 't1', name: 'Hope' } }))
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'Hope anchors the soul through every trial and points us forward.',
        timestamp_start: 0,
        timestamp_end: 60,
        topics: ['hope', 'endurance'],
        summary: 'On hope as an anchor for the soul',
      },
    ])

    const bookId = insertBook('hope')
    const result = await generateBook({ bookId, topic: 'hope' }, fakeAnthropic(), ctx)

    expect(result.status).toBe('ok')

    const book = getBook(bookId)
    expect(book?.status).toBe('done')
    expect(book?.title).toBe('A Book on Hope')
    expect(book?.chapter_count).toBe(2)

    const chapters = getBookChapters(bookId)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].idx).toBe(0)
    expect(chapters[0].heading).toBe('The Ground of Hope')
    expect(chapters[0].body).toContain('drafted chapter')
  })

  it('records the source sermons on the book', async () => {
    const id = saveSermon(sermon({ theme: { themeId: 't1', name: 'Hope' } }))
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'Hope is the confident expectation of good.',
        timestamp_start: 0,
        timestamp_end: 60,
        topics: ['hope'],
        summary: 'Defining hope',
      },
    ])

    const bookId = insertBook('hope')
    await generateBook({ bookId, topic: 'hope' }, fakeAnthropic(), ctx)

    const book = getBook(bookId)
    const sources = JSON.parse(book?.sources ?? '[]') as Array<{ title: string }>
    expect(sources).toHaveLength(1)
    expect(sources[0].title).toBe('On Hope')
  })

  it('fails cleanly when no sermons match the topic', async () => {
    const bookId = insertBook('nonexistent')
    const result = await generateBook({ bookId, topic: 'nonexistent' }, fakeAnthropic(), ctx)

    expect(result.status).toBe('error')
    expect(result.message).toMatch(/No sermons found/)
    expect(getBook(bookId)?.status).toBe('failed')
    expect(getBookChapters(bookId)).toHaveLength(0)
  })
})
