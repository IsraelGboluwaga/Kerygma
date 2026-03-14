import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { withRetry } from '../retry.js'
import type { TranscriptSegment } from './transcriber.js'

export interface ChunkCandidate {
  section_name: string
  timestamp_start: number
  timestamp_end: number
  topics: string[]
  summary: string
  content: string
}

export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function prepareTranscriptForChunking(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
    .join('\n')
}

function extractChunkText(
  segments: TranscriptSegment[],
  start: number,
  end: number
): string {
  return segments
    .filter((s) => s.start >= start && s.start < end)
    .map((s) => s.text)
    .join(' ')
}

export function validateChunks(chunks: ChunkCandidate[]): ChunkCandidate[] {
  chunks.sort((a, b) => a.timestamp_start - b.timestamp_start)

  // Both gap-filling (end < next.start) and overlap-trimming (end > next.start)
  // resolve to the same assignment, so one pass covers both.
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].timestamp_end = chunks[i + 1].timestamp_start
  }

  return chunks
}

export async function chunkSermon(
  segments: TranscriptSegment[],
  anthropic: Anthropic
): Promise<ChunkCandidate[]> {
  const formatted = prepareTranscriptForChunking(segments)

  const response = await withRetry(() => anthropic.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Analyze this sermon transcript and divide it into logical sections.
For each section, identify:
1. Section name (e.g., "Introduction", "Main Point 1: Walking by Faith", "Conclusion")
2. Start and end timestamps (in seconds)
3. Key topics discussed (3-5 keywords)
4. Brief summary (1-2 sentences)

Return ONLY a JSON array with this structure:
[
  {
    "section_name": "Introduction",
    "timestamp_start": 0.0,
    "timestamp_end": 180.5,
    "key_topics": ["welcome", "worship", "announcements"],
    "summary": "Pastor welcomes congregation and makes announcements."
  }
]

Transcript:
${formatted}`,
      },
    ],
  }))

  const firstBlock = response.content[0]
  if (!firstBlock || firstBlock.type !== 'text') {
    throw new Error(`Unexpected Claude response content type: ${firstBlock?.type ?? 'empty'}`)
  }
  let text = firstBlock.text

  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.split('\n').slice(1).join('\n')
    text = text.split('```')[0]
  }

  const raw = JSON.parse(text) as Array<{
    section_name: string
    timestamp_start: number
    timestamp_end: number
    key_topics: string[]
    summary: string
  }>

  const chunks: ChunkCandidate[] = raw.map((r) => ({
    section_name: r.section_name,
    timestamp_start: r.timestamp_start,
    timestamp_end: r.timestamp_end,
    topics: r.key_topics,
    summary: r.summary,
    content: extractChunkText(segments, r.timestamp_start, r.timestamp_end),
  }))

  return validateChunks(chunks)
}
