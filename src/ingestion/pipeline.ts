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
  insertTranscription,
  getTranscriptionBySermonId,
  recordMissingSermon,
  removeMissingSermon,
  type ThemeInput,
  type MissingSermonKind,
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
  videoId?: string         // API-provided stable ID; falls back to SHA256(downloadUrl)
  downloadUrl: string
  webpageUrl?: string
  title: string
  speaker: string
  date: string             // YYYY-MM-DD
  excerpt?: string
  theme?: ThemeInput
  tags?: string[]
  description?: string
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

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// A download URL with no audio to fetch: empty, or just AUDIO_BASE_URL with no
// file path appended. The API source builds this when a sermon's audio_url is
// blank (joinUrl(AUDIO_BASE_URL, '') === AUDIO_BASE_URL). Detected before the
// download step so we record a clear reason instead of a doomed fetch.
function hasNoAudioPath(url: string | undefined): boolean {
  const trimmed = url?.trim()
  if (!trimmed) return true
  return normalizeUrl(trimmed) === normalizeUrl(config.AUDIO_BASE_URL)
}

// Classify a failure so the missing_sermons table distinguishes transient
// problems (timeouts — retried automatically on the next sync) from permanent
// ones (no audio URL — needs an upstream fix).
function classifyFailure(err: unknown): MissingSermonKind {
  if (err instanceof AudioTooLongError) return 'too_long'
  const name = err instanceof Error ? err.name : ''
  const msg = errMsg(err).toLowerCase()
  if (name === 'TimeoutError' || name === 'AbortError' || /timed out|timeout|aborted/.test(msg)) {
    return 'timeout'
  }
  return 'error'
}

function recordMissing(req: IngestRequest, videoId: string, kind: MissingSermonKind, reason: string): void {
  try {
    recordMissingSermon({
      video_id: videoId,
      title: req.title || defaultTitle(req.downloadUrl),
      date: req.date,
      download_url: req.downloadUrl || undefined,
      webpage_url: req.webpageUrl,
      speaker: req.speaker,
      theme: req.theme?.name,
      kind,
      reason,
    })
  } catch (err) {
    logger.warn(`Failed to record missing sermon "${req.title}": ${errMsg(err)}`)
  }
}

// A successful ingest clears any prior missing-sermon entry for the same video.
function clearMissing(videoId: string): void {
  try {
    removeMissingSermon(videoId)
  } catch (err) {
    logger.warn(`Failed to clear missing sermon ${videoId}: ${errMsg(err)}`)
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
  const videoId = req.videoId ?? makeVideoId(req.downloadUrl)
  const title = req.title || defaultTitle(req.downloadUrl)

  const existing = getSermonByVideoId(videoId)

  // Resume from chunking — check new transcriptions table first, then legacy column
  if (existing && existing.ingestion_status === 'transcribed') {
    logger.info(`Resuming "${title}" — transcription already saved, skipping download`)
    try {
      const transcriptionRow = getTranscriptionBySermonId(existing.id)
      const segmentsJson = transcriptionRow?.segments ?? existing.transcription
      if (!segmentsJson) {
        throw new Error('Partial record found but no transcription data available')
      }
      const segments = JSON.parse(segmentsJson) as TranscriptSegment[]
      const chunkCount = await chunkEmbedSave(existing.id, title, segments, anthropic, onPhase)
      clearMissing(videoId)
      return {
        status: 'ok',
        message: `Ingested "${title}" — ${chunkCount} chunk(s)`,
        sermonId: existing.id,
      }
    } catch (err) {
      const message = errMsg(err)
      recordMissing(req, videoId, classifyFailure(err), message)
      return { status: 'error', message }
    }
  }

  // Already fully ingested
  if (existing) {
    clearMissing(videoId)
    return {
      status: 'duplicate',
      message: `Already ingested: "${existing.title}" (id=${existing.id})`,
      sermonId: existing.id,
    }
  }

  // No audio to fetch — record for review instead of attempting a doomed download
  if (hasNoAudioPath(req.downloadUrl)) {
    const message = `No audio for "${title}" — download_url has no file path appended to the audio base`
    logger.warn(message)
    recordMissing(req, videoId, 'no_audio', message)
    return { status: 'error', message }
  }

  let cleanup: (() => void) | undefined

  try {
    onPhase?.('downloading')
    const download = await downloadMp3(req.downloadUrl)
    cleanup = download.cleanup

    onPhase?.('transcribing')
    logger.info(`Transcribing "${title}"...`)
    const { segments, duration, transcript } = await transcribeAudio(download.filePath)

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
      excerpt: req.excerpt,
      theme: req.theme,
      description: req.description,
    })

    insertTranscription(sermonId, transcript, JSON.stringify(segments))

    const chunkCount = await chunkEmbedSave(sermonId, title, segments, anthropic, onPhase)

    clearMissing(videoId)
    return {
      status: 'ok',
      message: `Ingested "${title}" — ${chunkCount} chunk(s)`,
      sermonId,
    }
  } catch (err) {
    if (err instanceof AudioTooLongError) {
      recordMissing(req, videoId, 'too_long', err.message)
      return { status: 'too_long', message: err.message }
    }
    const message = err instanceof Error ? err.message : String(err)
    recordMissing(req, videoId, classifyFailure(err), message)
    return { status: 'error', message }
  } finally {
    cleanup?.()
  }
}
