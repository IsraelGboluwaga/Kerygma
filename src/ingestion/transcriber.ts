import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import OpenAI from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { errMsg } from '../utils.js'

export interface TranscriptSegment {
  text: string
  start: number    // seconds
  duration: number // seconds
}

export interface TranscribeResult {
  segments: TranscriptSegment[]
  duration: number   // seconds
  transcript: string // plain-text full transcription
}

// OpenAI Whisper API hard limit
const WHISPER_MAX_BYTES = 25 * 1024 * 1024  // 25 MB

// 24 kbps mono keeps even a 2-hour sermon under 25 MB (~21 MB)
// Whisper was trained on 16 kHz audio so 16 kHz sample rate is sufficient for accuracy
const FFMPEG_COMPRESS_ARGS = ['-ar', '16000', '-ac', '1', '-b:a', '24k']

const TRANSCRIPTION_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.OPENAI_API_KEY })
  return _client
}

function compressAudio(inputPath: string): { compressedPath: string; cleanup: () => void } {
  const compressedPath = path.join(
    os.tmpdir(),
    `kerygma-compressed-${Date.now()}.mp3`
  )
  logger.info(`Compressing audio to 16 kHz mono 24 kbps: ${inputPath}`)
  execFileSync('ffmpeg', [
    '-i', inputPath,
    ...FFMPEG_COMPRESS_ARGS,
    '-y', compressedPath,
  ])
  const { size } = fs.statSync(compressedPath)
  const sizeMb = (size / 1024 / 1024).toFixed(1)
  logger.info(`Compressed to ${sizeMb} MB`)
  if (size > WHISPER_MAX_BYTES) {
    fs.unlinkSync(compressedPath)
    throw new Error(
      `Audio is still ${sizeMb} MB after compression — exceeds the 25 MB Whisper API limit. ` +
      'The file may be too long; consider splitting it.'
    )
  }
  return {
    compressedPath,
    cleanup: () => { try { fs.unlinkSync(compressedPath) } catch { /* already gone */ } },
  }
}

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  logger.info(`Starting transcription: ${filePath}`)

  const { size } = fs.statSync(filePath)
  const sizeMb = (size / 1024 / 1024).toFixed(1)

  let uploadPath = filePath
  let cleanupCompressed: (() => void) | undefined

  if (size > WHISPER_MAX_BYTES) {
    logger.info(`File is ${sizeMb} MB — exceeds 25 MB Whisper limit, compressing with ffmpeg`)
    try {
      const compressed = compressAudio(filePath)
      uploadPath = compressed.compressedPath
      cleanupCompressed = compressed.cleanup
    } catch (err) {
      throw new Error(`Audio compression failed: ${errMsg(err)}`)
    }
  }

  try {
    const response = await getClient().audio.transcriptions.create(
      {
        file: fs.createReadStream(uploadPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
      },
      { timeout: TRANSCRIPTION_TIMEOUT_MS }
    )

    logger.info(`Transcription complete: ${filePath}`)

    const segments: TranscriptSegment[] = (response.segments ?? []).map((s) => ({
      text: s.text.trim(),
      start: s.start,
      duration: s.end - s.start,
    }))

    const duration =
      response.duration ??
      (segments.length > 0
        ? segments[segments.length - 1].start + segments[segments.length - 1].duration
        : 0)

    return { segments, duration, transcript: response.text }
  } finally {
    cleanupCompressed?.()
  }
}
