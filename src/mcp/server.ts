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

function buildContext(
  results: Array<{
    sermon_title: string
    date: string
    timestamp_start: number
    content: string
  }>
): string {
  return results
    .map(
      (r) =>
        `[${r.sermon_title} | ${r.date} | ${formatTimestamp(r.timestamp_start)}]\n${r.content}`
    )
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
      return { ...c, sermon_title: s.title, date: s.date, url: s.url, speaker: s.speaker }
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
    async ({ limit }) => {
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
            `• ${r.title}\n  Date: ${r.date}\n  Speaker: ${r.speaker ?? 'Unknown'}\n  URL: ${r.url}`
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
    async ({ question, date_filter, speaker_filter }) => {
      let resolvedSpeaker: string | undefined
      if (speaker_filter) {
        const resolution = resolveSpeaker(speaker_filter)
        if (!resolution.ok) {
          return { content: [{ type: 'text', text: resolution.message }] }
        }
        resolvedSpeaker = resolution.name
      }

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
              content: `Based on the following sermon excerpts, answer this question:
"${question}"

${context}

Provide a clear answer with citations. For each citation, include the sermon title, date, and timestamp.
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
    'Get a full summary of what was preached on a given date. Optionally filter by speaker.',
    {
      date: z
        .string()
        .describe('ISO date (YYYY-MM-DD) or partial date (YYYY-MM)'),
      speaker: z
        .string()
        .optional()
        .describe('Optional speaker name or partial name'),
    },
    async ({ date, speaker }) => {
      let resolvedSpeaker: string | undefined
      if (speaker) {
        const resolution = resolveSpeaker(speaker)
        if (!resolution.ok) {
          return { content: [{ type: 'text', text: resolution.message }] }
        }
        resolvedSpeaker = resolution.name
      }

      const dateResult = fetchChunksByDateAndSpeaker(date, resolvedSpeaker)
      if (!dateResult.ok) return dateResult

      const context = buildContext(dateResult.chunks)

      logger.info(
        `summarise_sermon: synthesising for ${date}${resolvedSpeaker ? ` by ${resolvedSpeaker}` : ''}`
      )
      const response = await withRetry(() =>
        anthropic.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: `Based on the following sermon excerpts, provide a comprehensive summary of what was preached.

${context}

Include the main themes, key points, and scripture references if mentioned.
Cite the sermon title, date, and relevant timestamps.`,
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
    async ({ topic, speaker_filter }) => {
      let resolvedSpeaker: string | undefined
      if (speaker_filter) {
        const resolution = resolveSpeaker(speaker_filter)
        if (!resolution.ok) {
          return { content: [{ type: 'text', text: resolution.message }] }
        }
        resolvedSpeaker = resolution.name
      }

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
            `URL: ${first.url}\n` +
            `Relevant sections:\n${sections}`
          )
        })
        .join('\n\n---\n\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  return server
}
