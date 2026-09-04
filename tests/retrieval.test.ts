import { describe, it, expect, beforeEach, vi } from 'vitest'

// The embedder is mocked so no real model loads. hybridSearchChunks embeds the
// *query* through generateEmbedding; we map specific query text → a specific
// vector via a hoisted registry so semantic ranking is fully deterministic.
// Chunk vectors are written straight into the DB by the tests (see `embedding`).
const { queryVectors } = vi.hoisted(() => ({
  queryVectors: new Map<string, Buffer>(),
}))

vi.mock('../src/ingestion/embedder.js', () => ({
  generateEmbedding: vi.fn(async (text: string) => {
    const v = queryVectors.get(text)
    // No registered vector → simulate the embedder being unavailable, which the
    // retrieval layer must tolerate by degrading to FTS-only.
    if (!v) throw new Error(`no test vector for query: ${text}`)
    return v
  }),
  loadEmbedder: vi.fn(),
}))

import { initDatabase } from '../src/db/connection.js'
import { saveSermon, saveChunks, searchChunks, type SaveSermonInput } from '../src/db/queries.js'
import { hybridSearchChunks } from '../src/retrieval.js'

const DIM = 384

// Build a normalized 384-dim Float32 embedding buffer from a few leading
// components (the rest zero). Mirrors the ingest encoding exactly: a Buffer over
// a Float32Array's bytes, L2-normalized so cosine similarity == dot product.
// Only the *direction* matters to cosine, so components set the axis mix.
function embedding(components: number[]): Buffer {
  const arr = new Float32Array(DIM)
  for (let i = 0; i < components.length; i++) arr[i] = components[i]
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += arr[i] * arr[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < DIM; i++) arr[i] /= norm
  return Buffer.from(arr.buffer)
}

function sermon(overrides: Partial<SaveSermonInput> = {}): SaveSermonInput {
  return {
    video_id: Math.random().toString(36).slice(2, 18),
    title: 'Untitled',
    date: '2023-05-01',
    download_url: 'https://example.com/a.mp3',
    ...overrides,
  }
}

beforeEach(() => {
  initDatabase(':memory:')
  queryVectors.clear()
})

describe('hybridSearchChunks — semantic retrieval', () => {
  it('finds a chunk that shares NO keywords with the query (pure vector hit)', async () => {
    // The query and the answer chunk have zero lexical overlap, so FTS alone
    // cannot find it — only the embedding proximity can.
    const query = 'HANDS acronym to defend the deity of Christ'
    queryVectors.set(query, embedding([1, 0, 0]))

    const answerId = saveSermon(sermon({ title: 'Christology 101' }))
    saveChunks(answerId, [
      {
        section_name: 'Argument',
        content: "The Messiah's divine nature is proven through scripture and eyewitness testimony.",
        timestamp_start: 30,
        timestamp_end: 90,
        embedding: embedding([1, 0.05, 0]), // ~identical direction to the query
      },
    ])

    const decoyId = saveSermon(sermon({ title: 'Household Budgeting' }))
    saveChunks(decoyId, [
      {
        section_name: 'Tips',
        content: 'Practical tips for budgeting your monthly finances and groceries.',
        timestamp_start: 0,
        timestamp_end: 60,
        embedding: embedding([0, 1, 0]), // orthogonal → cosine ~0
      },
    ])

    // FTS-only genuinely misses it: no shared tokens.
    expect(searchChunks(query)).toHaveLength(0)

    // Hybrid surfaces it via the semantic path, and it ranks first.
    const results = await hybridSearchChunks(query)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].sermon_title).toBe('Christology 101')
  })

  it('beats FTS-only on a paraphrase: ranks the semantic answer above the keyword decoy', async () => {
    const query = 'spiritual growth'
    queryVectors.set(query, embedding([1, 0, 0]))

    // DECOY: spams the query keywords (so FTS ranks it #1) but is off-topic and
    // its embedding points away from the query.
    const decoyId = saveSermon(sermon({ title: 'Church Event Planning' }))
    saveChunks(decoyId, [
      {
        section_name: 'Logistics',
        content: 'Spiritual growth events: our spiritual growth fair drives spiritual growth signups.',
        timestamp_start: 0,
        timestamp_end: 60,
        embedding: embedding([0, 0, 1]), // orthogonal to query
      },
    ])

    // ANSWER: the real paraphrase answer. Shares one token ("growth") so FTS
    // ranks it *below* the decoy, but its embedding is closest to the query.
    const answerId = saveSermon(sermon({ title: 'On Sanctification' }))
    saveChunks(answerId, [
      {
        section_name: 'Teaching',
        content: 'Sanctification is Christlike growth worked in us by the Spirit over a lifetime.',
        timestamp_start: 30,
        timestamp_end: 120,
        embedding: embedding([1, 0.05, 0]), // closest direction to the query
      },
    ])

    // THIRD: no query keyword (FTS misses it) but a middling embedding — it sits
    // between ANSWER and DECOY in the vector ranking, which is what tips RRF.
    const thirdId = saveSermon(sermon({ title: 'Stewardship' }))
    saveChunks(thirdId, [
      {
        section_name: 'Money',
        content: 'Generous giving reflects a heart surrendered to God.',
        timestamp_start: 0,
        timestamp_end: 45,
        embedding: embedding([0.6, 0.8, 0]), // cosine ~0.6 with the query
      },
    ])

    // FTS-only prefers the keyword-spam decoy — the wrong answer.
    const ftsOnly = searchChunks(query)
    expect(ftsOnly[0].sermon_title).toBe('Church Event Planning')

    // Hybrid re-ranks the true answer to the top.
    const hybrid = await hybridSearchChunks(query)
    expect(hybrid[0].sermon_title).toBe('On Sanctification')
  })

  it('degrades to FTS-only when the embedder is unavailable', async () => {
    // No vector registered for this query → the mock throws, standing in for the
    // embedder still warming up. Retrieval must fall back, not error.
    const id = saveSermon(sermon({ title: 'On Prayer' }))
    saveChunks(id, [
      {
        section_name: 'Intro',
        content: 'Prayer is communion with God and the breath of the believer.',
        timestamp_start: 0,
        timestamp_end: 60,
        embedding: embedding([1, 0, 0]),
      },
    ])

    const results = await hybridSearchChunks('prayer')
    expect(results).toHaveLength(1)
    expect(results[0].sermon_title).toBe('On Prayer')
  })

  it('honours the speaker filter across both retrievers', async () => {
    const query = 'grace'
    queryVectors.set(query, embedding([1, 0, 0]))

    const lajuId = saveSermon(sermon({ title: 'Grace Abounds', speaker: 'Pastor Laju' }))
    saveChunks(lajuId, [
      {
        section_name: 'Grace',
        content: 'Grace is the unmerited favour of God poured out on us.',
        timestamp_start: 0,
        timestamp_end: 60,
        embedding: embedding([1, 0, 0]),
      },
    ])

    const otherId = saveSermon(sermon({ title: 'Grace Again', speaker: 'Someone Else' }))
    saveChunks(otherId, [
      {
        section_name: 'Grace',
        content: 'Grace upon grace is given to the humble.',
        timestamp_start: 0,
        timestamp_end: 60,
        embedding: embedding([1, 0, 0]),
      },
    ])

    const results = await hybridSearchChunks(query, { speaker: 'Laju' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.sermon_title === 'Grace Abounds')).toBe(true)
  })
})
