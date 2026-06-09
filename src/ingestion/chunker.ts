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

interface RawSection {
  section_name: string
  timestamp_start: number
  timestamp_end: number
  key_topics: string[]
  summary: string
}

// Forcing the model to emit sections through a tool means the SDK hands us the
// already-parsed `input` object — we never JSON.parse free-form model text. This
// eliminates the two failure modes that previously broke ingestion: invalid
// escape sequences inside string values (e.g. `\"here I am\"`) and markdown code
// fences. Truncation is handled separately via `stop_reason` below.
const CHUNKING_TOOL: Anthropic.Tool = {
  name: 'emit_sections',
  description: 'Record the logical sections the sermon transcript has been divided into.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            section_name: {
              type: 'string',
              description: 'e.g. "Introduction", "Main Point 1: Walking by Faith", "Conclusion"',
            },
            timestamp_start: { type: 'number', description: 'Start time in seconds' },
            timestamp_end: { type: 'number', description: 'End time in seconds' },
            key_topics: {
              type: 'array',
              items: { type: 'string' },
              description: '3-5 keywords for the section',
            },
            summary: { type: 'string', description: '1-2 sentence summary of the section' },
          },
          required: ['section_name', 'timestamp_start', 'timestamp_end', 'key_topics', 'summary'],
        },
      },
    },
    required: ['sections'],
  },
}

export async function chunkSermon(
  segments: TranscriptSegment[],
  anthropic: Anthropic
): Promise<ChunkCandidate[]> {
  const formatted = prepareTranscriptForChunking(segments)

  const response = await withRetry(() => anthropic.messages.create({
    model: config.CHUNKING_MODEL,
    // Output is compact (section metadata only; section text is reconstructed
    // locally from `segments`), but long sermons produce many sections. 4096 was
    // too small and truncated the response, breaking ingestion — 16000 gives
    // ample headroom while staying within the non-streaming HTTP-timeout range.
    max_tokens: 16000,
    tools: [CHUNKING_TOOL],
    tool_choice: { type: 'tool', name: 'emit_sections' },
    messages: [
      {
        role: 'user',
        content: `Analyze this sermon transcript and divide it into logical sections, then call the emit_sections tool with the result. For each section provide a name, start and end timestamps in seconds, 3-5 key topics, and a 1-2 sentence summary.

Transcript:
${formatted}`,
      },
    ],
  }))

  // A forced tool call truncated by the token cap returns a partial, unusable
  // `input`. Fail loudly so the sermon is recorded as missing and retried rather
  // than silently saved with a clipped set of sections.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Chunking response was truncated at max_tokens — transcript too long for one pass')
  }

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Expected a tool_use response from chunking model, got stop_reason=${response.stop_reason}`)
  }

  const raw = (toolUse.input as { sections?: RawSection[] }).sections ?? []

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
