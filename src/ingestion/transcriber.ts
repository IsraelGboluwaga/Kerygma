import fs from 'node:fs'
// nodejs-whisper exposes a named export, not a default export
import { nodewhisper as whisper } from 'nodejs-whisper'
import shelljs from 'shelljs'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { errMsg } from '../utils.js'

// Suppress nodejs-whisper's verbose debug calls — actual transcript comes from the JSON sidecar
const silentLogger = {
  debug: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  log: () => {},
}

export interface TranscriptSegment {
  text: string
  start: number // seconds
  duration: number // seconds
}

export interface TranscribeResult {
  segments: TranscriptSegment[]
  duration: number // seconds
}

interface WhisperSegment {
  offsets: { from: number; to: number } // milliseconds
  text: string
}

interface WhisperOutput {
  transcription: WhisperSegment[]
}

export async function transcribeAudio(
  filePath: string,
): Promise<TranscribeResult> {
  logger.info(`Starting transcription: ${filePath}`)
  const wasSilent = shelljs.config.silent
  shelljs.config.silent = true
  try {
    await whisper(filePath, {
      modelName: config.WHISPER_MODEL,
      autoDownloadModelName: config.WHISPER_MODEL,
      removeWavFileAfterTranscription: false,
      whisperOptions: {
        outputInJsonFull: true,
      },
      logger: silentLogger,
    })
  } catch (err) {
    const full = errMsg(err)
    logger.error(`Whisper transcription failed:\n${full}`)
    const firstLine = full.split('\n').find((l) => l.trim()) ?? full
    throw new Error(`Transcription failed: ${firstLine.trim()}`)
  } finally {
    shelljs.config.silent = wasSilent
  }
  logger.info(`Transcription complete: ${filePath}`)

  // nodejs-whisper converts the input to WAV before running whisper-cli,
  // so the sidecar is written next to the WAV file, not the original MP3.
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav')
  const jsonPath = `${wavPath}.json`

  let raw: WhisperOutput
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as WhisperOutput
  } finally {
    // Clean up sidecars
    const txtPath = `${wavPath}.txt`
    for (const p of [jsonPath, wavPath, txtPath]) {
      try {
        fs.unlinkSync(p)
      } catch (err) {
        logger.warn(`Failed to delete temp file ${p}: ${errMsg(err)}`)
      }
    }
  }

  const segments: TranscriptSegment[] = raw.transcription.map((s) => ({
    text: s.text.trim(),
    start: s.offsets.from / 1000,
    duration: (s.offsets.to - s.offsets.from) / 1000,
  }))

  const duration =
    segments.length > 0
      ? segments[segments.length - 1].start +
        segments[segments.length - 1].duration
      : 0

  return { segments, duration }
}
