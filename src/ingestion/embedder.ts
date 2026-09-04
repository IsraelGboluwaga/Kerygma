import { pipeline as transformersPipeline } from '@xenova/transformers'

type EmbeddingPipeline = (
  texts: string | string[],
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: Float32Array }>

let _pipeline: EmbeddingPipeline | null = null

// `all-MiniLM-L6-v2` was trained with a 256 word-piece limit; the tokenizer
// silently truncates anything longer, so a long chunk's tail would never reach
// the vector. Rather than lose it, we embed the text in overlapping word windows
// and mean-pool the per-window vectors. A window is sized conservatively in
// *words* (word-pieces run 1.2–1.5× word count for English prose, so ~180 words
// stays comfortably under 256 pieces even with names/hyphenation); the model's
// own truncation remains a backstop for a pathological window. The overlap keeps
// a sentence that straddles a boundary represented on both sides.
export const EMBED_MAX_WORDS = 180
export const EMBED_WINDOW_OVERLAP = 20

/**
 * Split text into overlapping word windows, each at most `EMBED_MAX_WORDS` words.
 * Text at or under the limit is returned unchanged as a single window, so short
 * chunks (and every query) embed exactly as before — one window, no pooling.
 */
export function splitIntoWindows(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= EMBED_MAX_WORDS) return [text]

  const step = EMBED_MAX_WORDS - EMBED_WINDOW_OVERLAP
  const windows: string[] = []
  for (let i = 0; i < words.length; i += step) {
    windows.push(words.slice(i, i + EMBED_MAX_WORDS).join(' '))
    if (i + EMBED_MAX_WORDS >= words.length) break
  }
  return windows
}

export async function loadEmbedder(): Promise<void> {
  _pipeline = (await transformersPipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
  )) as EmbeddingPipeline
}

/**
 * Generate a 384-dim embedding for the given text.
 *
 * Long text is embedded in overlapping windows (see `splitIntoWindows`) and the
 * per-window unit vectors are mean-pooled, then L2-re-normalised so the result
 * is a unit vector — keeping cosine == dot product for the hybrid retrieval scan
 * (src/retrieval.ts) and preserving the single-vector-per-chunk storage shape.
 * The result is stored in chunks.embedding (BLOB) and used to embed chat queries.
 */
export async function generateEmbedding(text: string): Promise<Buffer> {
  if (!_pipeline) {
    throw new Error('Embedder not loaded — call loadEmbedder() first')
  }

  const windows = splitIntoWindows(text)

  // Common case (short chunk or query): a single window, returned as-is — byte
  // identical to the previous single-pass behaviour.
  if (windows.length === 1) {
    const output = await _pipeline(windows[0], { pooling: 'mean', normalize: true })
    // Raw Float32 bytes: 384 floats × 4 bytes = 1536 bytes per chunk
    return Buffer.from(output.data.buffer)
  }

  // Long text: accumulate the (unit) window vectors, then L2-normalise the sum.
  // The mean and the sum share a direction, so normalising the sum is equivalent
  // to normalising the mean — one fewer division.
  let acc: Float32Array | null = null
  for (const window of windows) {
    const { data } = await _pipeline(window, { pooling: 'mean', normalize: true })
    if (!acc) acc = new Float32Array(data.length)
    for (let i = 0; i < acc.length; i++) acc[i] += data[i]
  }

  // `acc` is non-null here: splitIntoWindows never returns an empty array (it
  // returns [text] when the input is short), so the loop ran at least once.
  const pooled = acc as Float32Array
  let norm = 0
  for (let i = 0; i < pooled.length; i++) norm += pooled[i] * pooled[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < pooled.length; i++) pooled[i] /= norm

  return Buffer.from(pooled.buffer)
}
