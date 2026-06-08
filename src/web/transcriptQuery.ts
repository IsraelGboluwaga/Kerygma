import type Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { withRetry } from '../retry.js'

// Structured intent extracted from a free-text transcript request. Any field may
// be absent — the route applies whichever filters are present (date AND topic are
// both honoured when the user gives both).
export interface TranscriptQuery {
  date?: string    // 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' — a date prefix
  topic?: string   // the subject the sermon should be *about*, e.g. "faith"
  theme?: string   // a formal theme name (from the structured filter dropdown)
  speaker?: string // a speaker name or fragment
}

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/

// Pull a JSON object out of a Claude text response, tolerating ```json fences.
function extractJson(text: string): string {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\n/i, '').replace(/```$/, '').trim()
  }
  return t
}

/**
 * Parse a free-text transcript request ("sermons in February 2023", "all sermons
 * on faith", "the message on the 4th of July 2021") into structured filters.
 *
 * Uses the cheap chunking model and is wrapped in withRetry like all other
 * Anthropic calls. On any parsing failure it returns an empty object so the
 * caller can fall back to a raw keyword search rather than erroring.
 */
export async function parseTranscriptQuery(
  text: string,
  anthropic: Anthropic
): Promise<TranscriptQuery> {
  const today = new Date().toISOString().slice(0, 10)

  const response = await withRetry(() =>
    anthropic.messages.create({
      model: config.CHUNKING_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Today's date is ${today}. Extract structured filters from this request for sermon transcripts.

Return ONLY a JSON object with any of these optional keys:
- "date": a date prefix in "YYYY", "YYYY-MM", or "YYYY-MM-DD" form. Use "YYYY-MM-DD" for a specific day, "YYYY-MM" for a whole month, "YYYY" for a whole year.
- "topic": the subject the sermon should be substantively *about* (e.g. "faith", "spiritual growth"). Use the core subject only, not filler words like "sermons on".
- "speaker": a speaker name or fragment if one is named.

Omit any key that does not apply. If nothing applies, return {}.

Examples:
"sermon on the 4th of July 2021" -> {"date":"2021-07-04"}
"sermons in February 2023" -> {"date":"2023-02"}
"all sermons on faith" -> {"topic":"faith"}
"messages by Pastor John about grace last year" -> {"date":"${Number(today.slice(0, 4)) - 1}","topic":"grace","speaker":"John"}

Request: ${text}`,
        },
      ],
    })
  )

  const block = response.content[0]
  if (!block || block.type !== 'text') return {}

  let parsed: { date?: unknown; topic?: unknown; speaker?: unknown }
  try {
    parsed = JSON.parse(extractJson(block.text))
  } catch {
    return {}
  }

  const result: TranscriptQuery = {}
  if (typeof parsed.date === 'string' && DATE_RE.test(parsed.date)) result.date = parsed.date
  if (typeof parsed.topic === 'string' && parsed.topic.trim()) result.topic = parsed.topic.trim()
  if (typeof parsed.speaker === 'string' && parsed.speaker.trim()) {
    result.speaker = parsed.speaker.trim()
  }
  return result
}
