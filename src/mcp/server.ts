import Anthropic from '@anthropic-ai/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { withRetry } from '../retry.js'
import {
  getChunksBySermonId,
  getSermonsByDate,
  getNearestSermonByDate,
  getSpeakersMatchingFilter,
  listSermons,
  searchChunks,
  type ChunkWithSermon,
} from '../db/queries.js'
import { formatTimestamp } from '../ingestion/chunker.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const CHUNK_CONTENT_CAP = 800

function buildContext(
  results: Array<{
    sermon_title: string
    date: string
    timestamp_start: number
    content: string
    webpage_url?: string | null
  }>
): string {
  return results
    .map((r) => {
      const header = `[${r.sermon_title} | ${r.date} | ${formatTimestamp(r.timestamp_start)}${r.webpage_url ? ` | Watch: ${r.webpage_url}` : ''}]`
      return `${header}\n${r.content.slice(0, CHUNK_CONTENT_CAP)}`
    })
    .join('\n\n')
}

type SpeakerResolution =
  | { ok: true; name: string }
  | { ok: false; message: string }

function resolveSpeaker(filter: string): SpeakerResolution {
  const matches = getSpeakersMatchingFilter(filter)
  if (matches.length === 0) {
    return { ok: false, message: `No speaker matching "${filter}" found in any sermon.` }
  }
  if (matches.length > 1) {
    const list = matches.map((s) => `• ${s}`).join('\n')
    return {
      ok: false,
      message: `Multiple speakers match "${filter}". Which did you mean?\n${list}`,
    }
  }
  return { ok: true, name: matches[0] }
}

type SpeakerFilterResult =
  | { ok: true; name: string | undefined }
  | { ok: false; response: { content: [{ type: 'text'; text: string }] } }

function resolveSpeakerFilter(filter: string | undefined): SpeakerFilterResult {
  if (!filter) return { ok: true, name: undefined }
  const resolution = resolveSpeaker(filter)
  if (!resolution.ok) return { ok: false, response: { content: [{ type: 'text', text: resolution.message }] } }
  return { ok: true, name: resolution.name }
}

function nearestDateMessage(date: string): string {
  const nearest = getNearestSermonByDate(date)
  if (!nearest) return `No sermons found for date: ${date}`
  return (
    `No sermons found for ${date}. ` +
    `The nearest available sermon is "${nearest.title}" on ${nearest.date}. ` +
    `Try again with that date.`
  )
}

type DateQueryResult =
  | { ok: true; chunks: ChunkWithSermon[] }
  | { ok: false; content: [{ type: 'text'; text: string }] }

// Shared by ask_church (date_filter branch) and summarise_sermon
function fetchChunksByDateAndSpeaker(
  date: string,
  resolvedSpeaker?: string
): DateQueryResult {
  let sermons = getSermonsByDate(date)
  if (sermons.length === 0) {
    return { ok: false, content: [{ type: 'text', text: nearestDateMessage(date) }] }
  }
  if (resolvedSpeaker) {
    const lower = resolvedSpeaker.toLowerCase()
    sermons = sermons.filter((s) => s.speaker?.toLowerCase() === lower)
    if (sermons.length === 0) {
      return {
        ok: false,
        content: [{ type: 'text', text: `No sermons by "${resolvedSpeaker}" found on ${date}.` }],
      }
    }
  }
  const sermonMap = new Map(sermons.map((s) => [s.id, s]))
  const chunks = sermons.flatMap((s) => getChunksBySermonId(s.id))
  return {
    ok: true,
    chunks: chunks.map((c) => {
      const s = sermonMap.get(c.sermon_id)!
      return { ...c, sermon_title: s.title, date: s.date, download_url: s.download_url, webpage_url: s.webpage_url, speaker: s.speaker, theme: s.theme ?? null }
    }),
  }
}

// ── MCP Server ─────────────────────────────────────────────────────────────

export function createMcpServer(anthropic: Anthropic): McpServer {
  const server = new McpServer({
    name: 'kerygma',
    version: '1.0.0',
  })

  // ── Tool 1: list_sermons ───────────────────────────────────────────────
  server.tool(
    'list_sermons',
    'List recently indexed sermons.',
    { limit: z.number().int().positive().default(20).describe('Max sermons to return') },
    // @ts-expect-error — TS2589: handler return type inference too deep
    async ({ limit }: { limit: number }) => {
      const rows = listSermons(limit)

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No sermons have been indexed yet. Please contact the administrator to add sermons.',
            },
          ],
        }
      }

      const text = rows
        .map(
          (r) =>
            `• ${r.title}\n  Date: ${r.date}\n  Speaker: ${r.speaker ?? 'Unknown'}${r.theme ? `\n  Theme: ${r.theme}` : ''}${r.webpage_url ? `\n  Watch: ${r.webpage_url}` : ''}`
        )
        .join('\n\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  // ── Tool 2: ask_church ─────────────────────────────────────────────────
  server.tool(
    'ask_church',
    'Answer a specific question using teachings from indexed sermons. Supports filtering by date and/or speaker.',
    {
      question: z.string().describe('The question to answer'),
      date_filter: z
        .string()
        .optional()
        .describe("Optional ISO date or partial date (e.g., '2024-04', '2024-01-15')"),
      speaker_filter: z
        .string()
        .optional()
        .describe('Optional speaker name or partial name to filter by'),
    },
    // @ts-expect-error — TS2589: handler return type inference too deep
    async ({ question, date_filter, speaker_filter }: { question: string; date_filter?: string; speaker_filter?: string }) => {
      const sf = resolveSpeakerFilter(speaker_filter)
      if (!sf.ok) return sf.response
      const resolvedSpeaker = sf.name

      let results: ChunkWithSermon[]

      if (date_filter) {
        const dateResult = fetchChunksByDateAndSpeaker(date_filter, resolvedSpeaker)
        if (!dateResult.ok) return dateResult
        results = dateResult.chunks
      } else {
        results = searchChunks(question, 10)
        if (resolvedSpeaker) {
          const lower = resolvedSpeaker.toLowerCase()
          results = results.filter((r) => r.speaker?.toLowerCase() === lower)
        }
      }

      if (results.length === 0) {
        return {
          content: [
            { type: 'text', text: 'No relevant content found. Try ingesting more sermons first.' },
          ],
        }
      }

      const context = buildContext(results)

      logger.info(`ask_church: synthesising answer for "${question}"`)
      const response = await withRetry(() =>
        anthropic.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: `You are a helpful assistant for ${config.MINISTRY_NAME}. Based on the following sermon excerpts, answer this question:
"${question}"

${context}

Provide a clear answer with citations. For each citation, include the sermon title, date, and timestamp. If a YouTube link is available for a cited sermon, include it so the user can watch it directly.
If the excerpts don't contain enough information to answer, say so.`,
            },
          ],
        })
      )

      const text =
        response.content[0].type === 'text' ? response.content[0].text : ''
      return { content: [{ type: 'text', text }] }
    }
  )

  // ── Tool 3: summarise_sermon ───────────────────────────────────────────
  server.tool(
    'summarise_sermon',
    'Get a summary of what was preached on a given date. IMPORTANT: Before calling this tool, ask the user whether they want a "brief" summary (key points only, faster) or a "comprehensive" summary (full breakdown with all themes, scripture references, and timestamps). Then pass their answer as summary_type.',
    {
      date: z
        .string()
        .describe('ISO date (YYYY-MM-DD) or partial date (YYYY-MM)'),
      speaker: z
        .string()
        .optional()
        .describe('Optional speaker name or partial name'),
      summary_type: z
        .enum(['brief', 'comprehensive'])
        .describe('Type of summary: "brief" (3-5 key points) or "comprehensive" (full breakdown)'),
    },
    // @ts-expect-error — TS2589: handler return type inference too deep
    async ({ date, speaker, summary_type }: { date: string; speaker?: string; summary_type: 'brief' | 'comprehensive' }) => {
      const sf = resolveSpeakerFilter(speaker)
      if (!sf.ok) return sf.response
      const resolvedSpeaker = sf.name

      const dateResult = fetchChunksByDateAndSpeaker(date, resolvedSpeaker)
      if (!dateResult.ok) return dateResult

      const allChunks = dateResult.chunks
      const sermon = allChunks[0]
      const youtubeLink = sermon?.webpage_url ? `\nWatch: ${sermon.webpage_url}` : ''

      // Rank chunks by summary length as a proxy for content density
      const ranked = [...allChunks].sort(
        (a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0)
      )

      const chunks = summary_type === 'brief' ? ranked.slice(0, 8) : ranked.slice(0, 20)

      // Re-sort selected chunks chronologically for coherent context
      chunks.sort((a, b) => a.timestamp_start - b.timestamp_start)

      const context = buildContext(chunks)

      const isBrief = summary_type === 'brief'
      const instruction = isBrief
        ? 'Provide a concise summary of 3-5 key points from this sermon. Be brief and direct.'
        : 'Provide a comprehensive summary including main themes, key points, scripture references, and timestamps.'

      logger.info(
        `summarise_sermon: ${summary_type} summary for ${date}${resolvedSpeaker ? ` by ${resolvedSpeaker}` : ''}`
      )
      const response = await withRetry(() =>
        anthropic.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: isBrief ? 1024 : 4096,
          messages: [
            {
              role: 'user',
              content: `You are a helpful assistant for ${config.MINISTRY_NAME}. Based on the following sermon excerpts, ${instruction}

${context}

Cite the sermon title, date, and relevant timestamps where appropriate.${youtubeLink ? `\n\nInclude this link for the full sermon: ${youtubeLink}` : ''}`,
            },
          ],
        })
      )

      const text =
        response.content[0].type === 'text' ? response.content[0].text : ''
      return { content: [{ type: 'text', text }] }
    }
  )

  // ── Tool 4: search_teachings ───────────────────────────────────────────
  server.tool(
    'search_teachings',
    'Search for teachings on a specific topic across all sermons.',
    {
      topic: z.string().describe('Topic to search for'),
      speaker_filter: z
        .string()
        .optional()
        .describe('Optional speaker name to filter by'),
    },
    async ({ topic, speaker_filter }: { topic: string; speaker_filter?: string }) => {
      const sf = resolveSpeakerFilter(speaker_filter)
      if (!sf.ok) return sf.response
      const resolvedSpeaker = sf.name

      let results = searchChunks(topic, 20)

      if (resolvedSpeaker) {
        const lower = resolvedSpeaker.toLowerCase()
        results = results.filter((r) => r.speaker?.toLowerCase() === lower)
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No teachings found on '${topic}'.` }],
        }
      }

      const grouped = new Map<string, typeof results>()
      for (const r of results) {
        const key = r.sermon_title
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(r)
      }

      const text = [...grouped.entries()]
        .map(([sermonTitle, chunks]) => {
          const first = chunks[0]
          const sections = chunks
            .map(
              (c) =>
                `  - ${c.section_name} [${formatTimestamp(c.timestamp_start)}]: ${c.summary ?? ''}`
            )
            .join('\n')
          return (
            `Sermon: ${sermonTitle}\n` +
            `Date: ${first.date}\n` +
            `Speaker: ${first.speaker ?? 'Unknown'}\n` +
            (first.theme ? `Theme: ${first.theme}\n` : '') +
            (first.webpage_url ? `Watch: ${first.webpage_url}\n` : '') +
            `Relevant sections:\n${sections}`
          )
        })
        .join('\n\n---\n\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  return server
}
