import fs from 'node:fs'
import path from 'node:path'
// nodejs-whisper exposes a named export, not a default export
import { nodewhisper as whisper } from 'nodejs-whisper'
import { config } from '../config.js'

export interface TranscriptSegment {
  text: string
  start: number    // seconds
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

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  await whisper(filePath, {
    modelName: config.WHISPER_MODEL,
    autoDownloadModelName: config.WHISPER_MODEL,
    removeWavFileAfterTranscription: false,
    withCuda: false,
    whisperOptions: {
      outputInJsonFull: true,
      wordTimestamps: false,
    },
  })

  // nodejs-whisper converts the input to WAV before running whisper-cli,
  // so the sidecar is written next to the WAV file, not the original MP3.
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav')
  const jsonPath = `${wavPath}.json`

  let raw: WhisperOutput
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as WhisperOutput
  } finally {
    // Clean up sidecars
    try { fs.unlinkSync(jsonPath) } catch { /* ignore */ }
    try { fs.unlinkSync(wavPath) } catch { /* ignore */ }
    const txtPath = `${wavPath}.txt`
    try { fs.unlinkSync(txtPath) } catch { /* ignore */ }
  }

  const segments: TranscriptSegment[] = raw.transcription.map((s) => ({
    text: s.text.trim(),
    start: s.offsets.from / 1000,
    duration: (s.offsets.to - s.offsets.from) / 1000,
  }))

  const duration =
    segments.length > 0
      ? segments[segments.length - 1].start + segments[segments.length - 1].duration
      : 0

  return { segments, duration }
}
