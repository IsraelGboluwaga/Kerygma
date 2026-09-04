import { describe, it, expect, beforeEach, vi } from 'vitest'

// The real @xenova/transformers pulls native `sharp` at import time, which can't
// initialise in some sandboxes — and we don't want a real model here anyway. Mock
// the pipeline with a fake that returns one unit basis vector per call, so we can
// assert exactly how many windows were embedded and how they were pooled.
const { state } = vi.hoisted(() => ({ state: { call: 0, dim: 384 } }))

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(async () => (_text: string) => {
    const v = new Float32Array(state.dim)
    v[state.call % state.dim] = 1 // window N → e_N (a distinct axis per call)
    state.call++
    return { data: v }
  }),
}))

import {
  loadEmbedder,
  generateEmbedding,
  splitIntoWindows,
  EMBED_MAX_WORDS,
  EMBED_WINDOW_OVERLAP,
} from '../src/ingestion/embedder.js'

const DIM = 384

function decode(buf: Buffer): Float32Array {
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(aligned)
}

const words = (n: number): string =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

beforeEach(async () => {
  state.call = 0
  await loadEmbedder()
})

describe('splitIntoWindows', () => {
  it('returns short text unchanged as a single window', () => {
    const text = words(EMBED_MAX_WORDS) // exactly at the limit → still one window
    expect(splitIntoWindows(text)).toEqual([text])
  })

  it('splits long text into overlapping windows that cover every word', () => {
    const total = 400
    const wins = splitIntoWindows(words(total))
    expect(wins.length).toBeGreaterThan(1)

    // Every window is within the word cap.
    for (const w of wins) {
      expect(w.split(/\s+/).length).toBeLessThanOrEqual(EMBED_MAX_WORDS)
    }
    // Consecutive windows overlap by EMBED_WINDOW_OVERLAP words.
    const first = wins[0].split(/\s+/)
    const second = wins[1].split(/\s+/)
    expect(second.slice(0, EMBED_WINDOW_OVERLAP)).toEqual(
      first.slice(first.length - EMBED_WINDOW_OVERLAP)
    )
    // Coverage is complete: the last window ends on the last word.
    expect(wins[wins.length - 1].endsWith(`w${total - 1}`)).toBe(true)
  })
})

describe('generateEmbedding', () => {
  it('embeds short text in a single pass (no pooling)', async () => {
    const out = decode(await generateEmbedding('a short chunk'))
    expect(state.call).toBe(1) // exactly one window embedded
    expect(out[0]).toBeCloseTo(1) // returned as-is: e_0
    expect(out[1]).toBeCloseTo(0)
  })

  it('mean-pools and re-normalises across windows for long text', async () => {
    // 400 words → 3 windows (step = 160), embedded as e_0, e_1, e_2. The pooled
    // sum is [1,1,1,0,…]; normalised, each of the three axes is 1/√3.
    const out = decode(await generateEmbedding(words(400)))
    expect(state.call).toBe(3)

    const expected = 1 / Math.sqrt(3)
    expect(out[0]).toBeCloseTo(expected, 5)
    expect(out[1]).toBeCloseTo(expected, 5)
    expect(out[2]).toBeCloseTo(expected, 5)
    expect(out[3]).toBeCloseTo(0, 5)

    // Result is a unit vector, so cosine still reduces to a dot product.
    let norm = 0
    for (let i = 0; i < DIM; i++) norm += out[i] * out[i]
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5)
  })
})
