// @ts-expect-error — @xenova/transformers has no bundled types
import { pipeline as transformersPipeline } from '@xenova/transformers'

type EmbeddingPipeline = (
  texts: string | string[],
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: Float32Array }>

let _pipeline: EmbeddingPipeline | null = null

export async function loadEmbedder(): Promise<void> {
  _pipeline = (await transformersPipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
  )) as EmbeddingPipeline
}

/**
 * Generate a 384-dim embedding for the given text.
 *
 * The result is stored in chunks.embedding (BLOB) and is reserved for a future
 * vector / semantic search path. It is not queried by any current code path.
 */
export async function generateEmbedding(text: string): Promise<Buffer> {
  if (!_pipeline) {
    throw new Error('Embedder not loaded — call loadEmbedder() first')
  }

  const output = await _pipeline(text, { pooling: 'mean', normalize: true })
  // Raw Float32 bytes: 384 floats × 4 bytes = 1536 bytes per chunk
  return Buffer.from(output.data.buffer)
}
