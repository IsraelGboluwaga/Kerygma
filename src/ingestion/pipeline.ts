import crypto from 'node:crypto'
import path from 'node:path'
import { URL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getSermonByVideoId, saveSermon, saveChunks } from '../db/queries.js'
import { downloadMp3 } from './downloader.js'
import { transcribeAudio } from './transcriber.js'
import { chunkSermon } from './chunker.js'
import { generateEmbedding } from './embedder.js'

export interface IngestRequest {
  mp3Url: string
  webpageUrl?: string
  title: string
  speaker: string
  date: string          // YYYY-MM-DD
  tags?: string[]
}

export type IngestStatus = 'ok' | 'duplicate' | 'too_long' | 'error'

export interface IngestResult {
  status: IngestStatus
  message: string
  sermonId?: number
}

export class AudioTooLongError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioTooLongError'
  }
}

function makeVideoId(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)
}

function defaultTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return path.basename(pathname, path.extname(pathname)) || url
  } catch {
    return url
  }
}

export async function ingestSermon(
  req: IngestRequest,
  anthropic: Anthropic
): Promise<IngestResult> {
  const videoId = makeVideoId(req.mp3Url)
  const title = req.title || defaultTitle(req.mp3Url)

  // Duplicate check
  const existing = getSermonByVideoId(videoId)
  if (existing) {
    return {
      status: 'duplicate',
      message: `Already ingested: "${existing.title}" (id=${existing.id})`,
      sermonId: existing.id,
    }
  }

  let cleanup: (() => void) | undefined

  try {
    const download = await downloadMp3(req.mp3Url)
    cleanup = download.cleanup
    const filePath = download.filePath

    // Transcribe
    logger.info(`Transcribing "${title}"...`)
    const { segments, duration } = await transcribeAudio(filePath)

    // Duration check
    const maxDuration = config.MAX_AUDIO_DURATION_SECONDS
    if (duration > maxDuration) {
      const durationMin = Math.floor(duration / 60)
      const limitMin = Math.floor(maxDuration / 60)
      throw new AudioTooLongError(
        `"${title}" is ${durationMin} min — exceeds ${limitMin}-min limit`
      )
    }

    // Chunk with Claude
    logger.info(`Chunking "${title}" with Claude...`)
    const chunks = await chunkSermon(segments, anthropic)

    // Generate embeddings — stored for future vector/semantic search (not queried yet)
    logger.info(`Embedding ${chunks.length} chunk(s) for "${title}"...`)
    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (c) => ({
        ...c,
        embedding: await generateEmbedding(c.content),
      }))
    )

    // Persist
    const sermonId = saveSermon({
      video_id: videoId,
      title,
      date: req.date,
      url: req.mp3Url,
      webpage_url: req.webpageUrl,
      speaker: req.speaker,
      duration: Math.round(duration),
      tags: req.tags,
    })

    saveChunks(
      sermonId,
      chunksWithEmbeddings.map((c) => ({
        section_name: c.section_name,
        content: c.content,
        timestamp_start: c.timestamp_start,
        timestamp_end: c.timestamp_end,
        topics: c.topics,
        summary: c.summary,
        embedding: c.embedding,
      }))
    )

    return {
      status: 'ok',
      message: `Ingested "${title}" — ${chunks.length} chunk(s)`,
      sermonId,
    }
  } catch (err) {
    if (err instanceof AudioTooLongError) {
      return { status: 'too_long', message: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', message }
  } finally {
    cleanup?.()
  }
}
