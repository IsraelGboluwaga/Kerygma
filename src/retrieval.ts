import { generateEmbedding } from './ingestion/embedder.js'
import {
  searchChunks,
  getChunkEmbeddings,
  getChunksByIds,
  type ChunkWithSermon,
} from './db/queries.js'
import { logger } from './logger.js'
import { errMsg } from './utils.js'

// ── Hybrid retrieval: FTS5 (lexical) + semantic vectors, fused with RRF ───────
//
// The excerpt search used to be a fixed top-10 FTS5 sample. Two problems as the
// library grows: (1) 10 excerpts cover a shrinking fraction of relevant material,
// and (2) lexical-only search misses paraphrases whose wording doesn't overlap
// the transcript. This module fixes both by fusing two rankings:
//
//   • lexical  — chunks_fts MATCH ... ORDER BY rank  (searchChunks)
//   • semantic — cosine(query embedding, stored chunk embedding)
//
// Fusion uses Reciprocal Rank Fusion (RRF), which combines the two by *rank*,
// not score. That sidesteps normalising two incompatible scales (BM25's rank
// metric vs. cosine similarity) and is the robust, well-established default.
//
// Vector search is a brute-force in-process scan. The embedder emits L2-
// normalised vectors (normalize: true), so cosine similarity reduces to a dot
// product. At the current corpus size (a single church's sermon library — on
// the order of 10^3–10^4 chunks) a linear scan is single-digit-to-tens-of-ms
// and needs no native ANN dependency or index to maintain, matching this app's
// single-singleton, no-pooling SQLite design. The scan time is logged at debug
// so it stays measurable; revisit with sqlite-vec / an ANN index once the corpus
// exceeds ~100k chunks or the scan p95 climbs past ~50ms (see SCAN_WARN_MS).

const EMBEDDING_DIM = 384
const EMBEDDING_BYTES = EMBEDDING_DIM * 4 // Float32 → 4 bytes each

// Depth pulled from each retriever before fusion. Wider than the returned set so
// a chunk ranked mid-pack by one retriever but top by the other still surfaces.
const CANDIDATE_K = 50
// RRF damping constant. 60 is the value from the original RRF paper and the de
// facto standard; larger flattens the contribution of top ranks.
const RRF_K = 60
// Reranked excerpts returned by default — a sensible bump from the old fixed 10,
// not a blind widening: candidates are fused and truncated to this.
export const DEFAULT_RESULT_K = 15
// Defensive cap on the text handed to the embedder — the chat endpoint is rate
// limited, but this bounds per-request embedding cost regardless of caller.
const MAX_QUERY_CHARS = 2000
// Log a warning if a single scan crosses this — the signal to consider an ANN
// index (see the module note above).
const SCAN_WARN_MS = 50

export interface HybridSearchOptions {
  limit?: number
  /** Speaker name/alias-resolved value; filters both retrievers identically. */
  speaker?: string
}

/**
 * Decode a stored embedding blob into a Float32Array.
 *
 * Guards against two hazards: a truncated/corrupt blob (wrong byte length), and
 * Node Buffer pooling — a Buffer's `byteOffset` can be non-4-aligned, which a
 * Float32Array view cannot address directly. We copy the exact bytes into a
 * fresh, offset-0 (aligned) ArrayBuffer before viewing. Returns null on any
 * malformed input so a bad row is skipped rather than poisoning the scan.
 */
function decodeEmbedding(buf: Buffer): Float32Array | null {
  if (!Buffer.isBuffer(buf) || buf.byteLength !== EMBEDDING_BYTES) return null
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(aligned)
}

/** Dot product. For L2-normalised vectors this equals cosine similarity. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/**
 * Semantic candidate ids, best (most similar) first. Best-effort: if the
 * embedder isn't loaded yet (it warms up in the background at startup) or fails,
 * or the query embeds to a degenerate zero vector, this returns an empty list so
 * the caller degrades to FTS-only rather than erroring the whole request.
 */
async function semanticCandidates(query: string, speaker?: string): Promise<number[]> {
  let queryVec: Float32Array | null
  try {
    const buf = await generateEmbedding(query.slice(0, MAX_QUERY_CHARS))
    queryVec = decodeEmbedding(buf)
  } catch (err) {
    logger.debug(`Semantic search skipped (embedder unavailable): ${errMsg(err)}`)
    return []
  }
  if (!queryVec) return []

  // A zero (or near-zero) query vector carries no direction — every dot product
  // is ~0 and the ranking would be meaningless. Skip semantic in that case.
  let norm = 0
  for (let i = 0; i < queryVec.length; i++) norm += queryVec[i] * queryVec[i]
  if (norm === 0) return []

  const started = Date.now()
  const rows = getChunkEmbeddings(speaker)
  const scored: { id: number; score: number }[] = []
  for (const row of rows) {
    const v = decodeEmbedding(row.embedding)
    if (!v) continue
    scored.push({ id: row.id, score: dot(queryVec, v) })
  }
  scored.sort((a, b) => b.score - a.score)

  const elapsed = Date.now() - started
  const log = elapsed > SCAN_WARN_MS ? logger.warn.bind(logger) : logger.debug.bind(logger)
  log(`Semantic scan: ${rows.length} chunk vectors in ${elapsed}ms`)

  return scored.slice(0, CANDIDATE_K).map((s) => s.id)
}

/**
 * Reciprocal Rank Fusion over several ranked id lists.
 * score(id) = Σ_lists 1 / (RRF_K + rank), rank being 1-based position in a list.
 */
function rrfFuse(rankedLists: number[][], limit: number): number[] {
  const scores = new Map<number, number>()
  for (const list of rankedLists) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + idx + 1))
    })
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * Hybrid excerpt search. Returns fused, reranked chunks with the exact same
 * citation shape as searchChunks (title, speaker, date, timestamp, url), so the
 * chat and MCP callers — and the frontend contract — are unchanged.
 */
export async function hybridSearchChunks(
  query: string,
  opts: HybridSearchOptions = {}
): Promise<ChunkWithSermon[]> {
  const limit = opts.limit ?? DEFAULT_RESULT_K

  // Lexical candidates come back as full rows (reused below to avoid re-fetching
  // their content); semantic candidates come back as ids only.
  const ftsRows = searchChunks(query, CANDIDATE_K, opts.speaker)
  const ftsIds = ftsRows.map((r) => r.id)
  const vecIds = await semanticCandidates(query, opts.speaker)

  if (ftsIds.length === 0 && vecIds.length === 0) return []

  const fusedIds = rrfFuse([ftsIds, vecIds], limit)

  // We already hold the FTS candidates' rows; hydrate only the ids that came in
  // via the vector path alone.
  const byId = new Map<number, ChunkWithSermon>(ftsRows.map((r) => [r.id, r]))
  const missing = fusedIds.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    for (const row of getChunksByIds(missing)) byId.set(row.id, row)
  }

  return fusedIds
    .map((id) => byId.get(id))
    .filter((r): r is ChunkWithSermon => r != null)
}
