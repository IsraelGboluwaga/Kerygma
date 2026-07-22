import { formatTimestamp } from './ingestion/chunker.js'

// Shared by the MCP server and the chat tool so the citation format and the
// excerpt truncation cap live in one place instead of two independently
// maintained copies.
export const EXCERPT_CONTENT_CAP = 800

export interface ExcerptSource {
  sermon_title: string
  date: string
  timestamp_start: number
  content: string
  speaker?: string | null
  url?: string | null
}

export interface FormatExcerptOptions {
  includeSpeaker?: boolean
  urlLabel?: string
}

export function formatSermonExcerpt(r: ExcerptSource, opts: FormatExcerptOptions = {}): string {
  const parts = [r.sermon_title]
  if (opts.includeSpeaker) parts.push(r.speaker ?? 'Unknown')
  parts.push(r.date, formatTimestamp(r.timestamp_start))
  if (r.url) parts.push(`${opts.urlLabel ?? 'URL'}: ${r.url}`)
  return `[${parts.join(' | ')}]\n${r.content.slice(0, EXCERPT_CONTENT_CAP)}`
}

export function formatSermonExcerpts(results: ExcerptSource[], opts: FormatExcerptOptions = {}): string {
  return results.map((r) => formatSermonExcerpt(r, opts)).join('\n\n')
}
