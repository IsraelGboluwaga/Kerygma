import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { parseTranscriptQuery } from '../src/web/transcriptQuery.js'

// Minimal Anthropic stub: messages.create resolves to a single text block.
function fakeAnthropic(text: string): Anthropic {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text }] }),
    },
  } as unknown as Anthropic
}

describe('parseTranscriptQuery', () => {
  it('extracts a specific date', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('{"date":"2021-07-04"}'))
    expect(out).toEqual({ date: '2021-07-04' })
  })

  it('extracts a month prefix', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('{"date":"2023-02"}'))
    expect(out).toEqual({ date: '2023-02' })
  })

  it('extracts a theme', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('{"theme":"faith"}'))
    expect(out).toEqual({ theme: 'faith' })
  })

  it('extracts combined filters', async () => {
    const out = await parseTranscriptQuery(
      'x',
      fakeAnthropic('{"date":"2023","theme":"grace","speaker":"John"}')
    )
    expect(out).toEqual({ date: '2023', theme: 'grace', speaker: 'John' })
  })

  it('strips code fences', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('```json\n{"theme":"hope"}\n```'))
    expect(out).toEqual({ theme: 'hope' })
  })

  it('rejects malformed dates', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('{"date":"July 2021"}'))
    expect(out).toEqual({})
  })

  it('returns {} on invalid JSON', async () => {
    const out = await parseTranscriptQuery('x', fakeAnthropic('not json'))
    expect(out).toEqual({})
  })

  it('returns {} on a non-text response block', async () => {
    const weird = {
      messages: { create: async () => ({ content: [{ type: 'tool_use' }] }) },
    } as unknown as Anthropic
    expect(await parseTranscriptQuery('x', weird)).toEqual({})
  })
})
