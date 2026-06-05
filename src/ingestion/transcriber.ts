import fs from 'node:fs'
import OpenAI from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'

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

// OpenAI Whisper API hard limit — files above this will be rejected with 413
const WHISPER_MAX_BYTES = 25 * 1024 * 1024  // 25 MB

// Default SDK timeout is 10 min; large uploads on slow connections can still hit it,
// so we set an explicit ceiling slightly above the worst-case estimate.
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60 * 1000  // 10 minutes

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.OPENAI_API_KEY })
  return _client
}

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  logger.info(`Starting transcription: ${filePath}`)

  const { size } = fs.statSync(filePath)
  if (size > WHISPER_MAX_BYTES) {
    const sizeMb = (size / 1024 / 1024).toFixed(1)
    throw new Error(
      `Audio file is ${sizeMb} MB — OpenAI Whisper API limit is 25 MB. ` +
      'Re-encode at a lower bitrate or split the file.'
    )
  }

  // response_format: 'verbose_json' is overloaded to return TranscriptionVerbose
  const response = await getClient().audio.transcriptions.create(
    {
      file: fs.createReadStream(filePath),
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
}
