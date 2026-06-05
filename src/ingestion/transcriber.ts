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

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: config.OPENAI_API_KEY })
  return _client
}

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  logger.info(`Starting transcription: ${filePath}`)

  // response_format: 'verbose_json' is overloaded to return TranscriptionVerbose
  const response = await getClient().audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    response_format: 'verbose_json',
  })

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
