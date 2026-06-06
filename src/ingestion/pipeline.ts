import crypto from 'node:crypto'
import path from 'node:path'
import { URL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { errMsg } from '../utils.js'
import {
  getSermonByVideoId,

  insertPartialSermon,
  completeSermon,
  saveChunks,
} from '../db/queries.js'
import type { TranscriptSegment } from './transcriber.js'
import { downloadMp3 } from './downloader.js'
import { transcribeAudio } from './transcriber.js'
import { chunkSermon } from './chunker.js'
import { generateEmbedding } from './embedder.js'
import type { JobPhase } from '../queue.js'

/** Optional progress reporter; ingestion runs fine when omitted (e.g. in tests). */
export type PhaseReporter = (phase: JobPhase) => void

export interface IngestRequest {
  downloadUrl: string
  webpageUrl?: string
  title: string
  speaker: string
  date: string          // YYYY-MM-DD
  series?: string
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

function formatSeries(series: string | undefined, date: string): string | undefined {
  if (!series) return undefined
  const year = date.slice(0, 4)
  return `${series}-${year}`
}

function defaultTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return path.basename(pathname, path.extname(pathname)) || url
  } catch {
    return url
  }
}

async function chunkEmbedSave(
  sermonId: number,
  title: string,
  segments: TranscriptSegment[],
  anthropic: Anthropic,
  onPhase?: PhaseReporter
): Promise<number> {
  onPhase?.('chunking')
  logger.debug(`Chunking "${title}" with Claude...`)
  const chunks = await chunkSermon(segments, anthropic)

  onPhase?.('embedding')
  logger.debug(`Embedding ${chunks.length} chunk(s) for "${title}"...`)
  const chunksWithEmbeddings = await Promise.all(
    chunks.map(async (c) => ({
      ...c,
      embedding: await generateEmbedding(c.content),
    }))
  )

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

  completeSermon(sermonId)
  return chunks.length
}

export async function ingestSermon(
  req: IngestRequest,
  anthropic: Anthropic,
  onPhase?: PhaseReporter
): Promise<IngestResult> {
  const videoId = makeVideoId(req.downloadUrl)
  const title = req.title || defaultTitle(req.downloadUrl)

  const existing = getSermonByVideoId(videoId)

  // Resume from chunking if transcription was already saved
  if (existing && existing.ingestion_status === 'transcribed' && existing.transcription) {
    logger.info(`Resuming "${title}" — transcription already saved, skipping download`)
    try {
      const segments = JSON.parse(existing.transcription) as TranscriptSegment[]
      const chunkCount = await chunkEmbedSave(existing.id, title, segments, anthropic, onPhase)
      return {
        status: 'ok',
        message: `Ingested "${title}" — ${chunkCount} chunk(s)`,
        sermonId: existing.id,
      }
    } catch (err) {
      const message = errMsg(err)
      return { status: 'error', message }
    }
  }

  // Already fully ingested
  if (existing) {
    return {
      status: 'duplicate',
      message: `Already ingested: "${existing.title}" (id=${existing.id})`,
      sermonId: existing.id,
    }
  }

  let cleanup: (() => void) | undefined

  try {
    onPhase?.('downloading')
    const download = await downloadMp3(req.downloadUrl)
    cleanup = download.cleanup

    onPhase?.('transcribing')
    logger.info(`Transcribing "${title}"...`)
    const { segments, duration } = await transcribeAudio(download.filePath)

    // Duration check before touching the DB
    const maxDuration = config.MAX_AUDIO_DURATION_SECONDS
    if (duration > maxDuration) {
      const durationMin = Math.floor(duration / 60)
      const limitMin = Math.floor(maxDuration / 60)
      throw new AudioTooLongError(
        `"${title}" is ${durationMin} min — exceeds ${limitMin}-min limit`
      )
    }

    // Save partial record — if chunking/embedding fails, next retry resumes here
    const sermonId = insertPartialSermon({
      video_id: videoId,
      title,
      date: req.date,
      download_url: req.downloadUrl,
      webpage_url: req.webpageUrl,
      speaker: req.speaker,
      duration: Math.round(duration),
      tags: req.tags,
      series: formatSeries(req.series, req.date),
      transcription: JSON.stringify(segments),
    })

    const chunkCount = await chunkEmbedSave(sermonId, title, segments, anthropic, onPhase)

    return {
      status: 'ok',
      message: `Ingested "${title}" — ${chunkCount} chunk(s)`,
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
