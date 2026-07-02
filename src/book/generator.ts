import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { withRetry } from '../retry.js'
import { logger } from '../logger.js'
import { errMsg } from '../utils.js'
import { formatSermonDate } from '../web/transcriptFormat.js'
import type { JobContext } from '../queue.js'
import {
  searchSermonsByTopic,
  getSermonsByThemeName,
  findSermonsByTitle,
  getChunksBySermonId,
  setBookTitleAndSources,
  setBookChapterCount,
  addBookChapter,
  markBookDone,
  markBookFailed,
  type SermonRow,
  type ChunkRow,
  type BookSource,
} from '../db/queries.js'

export interface BookRequest {
  bookId: number
  topic: string
}

// A structured result the job queue maps to a terminal job state: 'error' marks
// the job failed (with `message`), anything else marks it done.
export interface BookResult {
  status: 'ok' | 'error'
  message: string
}

// Caps keep a single book bounded in cost and time. A book is a synthesis of
// already-ingested material, so the only spend is Claude tokens.
const MAX_CORPUS_SERMONS = 30
const MAX_BOOK_CHAPTERS = 12
// Per-chapter cap on grounding text fed to the model (chars). ~24k chars ≈ 6k tokens.
const MAX_CHAPTER_SOURCE_CHARS = 24_000

interface CorpusEntry {
  sermon: SermonRow
  chunks: ChunkRow[]
}

interface OutlineChapter {
  heading: string
  focus: string
  sermon_ids: number[]
}

interface Outline {
  title: string
  chapters: OutlineChapter[]
}

// The complete roster of sermons that are *about* the topic. Mirrors the topic
// branch of the chat's resolveTranscriptSermons: relevance density first, then a
// formal-theme match, then a literal-title match — never a bare content keyword
// match (which for a common word like "hope" would pull in nearly everything).
function resolveBookCorpus(topic: string): SermonRow[] {
  let rows = searchSermonsByTopic(topic, MAX_CORPUS_SERMONS)
  if (rows.length === 0) rows = getSermonsByThemeName(topic)
  if (rows.length === 0) rows = findSermonsByTitle(topic, MAX_CORPUS_SERMONS)
  return rows.slice(0, MAX_CORPUS_SERMONS)
}

// Compact, metadata-only description of a sermon for the outline pass — section
// summaries/topics, not full text, so the whole corpus fits comfortably in one
// prompt. The `[id N]` prefix lets the model reference sermons by id per chapter.
function sermonDigest(entry: CorpusEntry): string {
  const s = entry.sermon
  const head = `[id ${s.id}] "${s.title}" — ${s.speaker ?? 'Unknown speaker'} — ${formatSermonDate(s.date)}`
  const sections = entry.chunks
    .slice(0, 12)
    .map((c) => `  • ${c.section_name}: ${c.summary?.trim() || c.section_name}`)
    .join('\n')
  return sections ? `${head}\n${sections}` : head
}

const OUTLINE_TOOL: Anthropic.Tool = {
  name: 'emit_outline',
  description: 'Record the designed book outline.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A compelling, specific book title' },
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string', description: 'The chapter heading' },
            focus: { type: 'string', description: 'One or two sentences on what the chapter covers' },
            sermon_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'The ids (from the provided material) of the sermons whose content grounds this chapter',
            },
          },
          required: ['heading', 'focus', 'sermon_ids'],
        },
      },
    },
    required: ['title', 'chapters'],
  },
}

async function generateOutline(
  topic: string,
  corpus: CorpusEntry[],
  anthropic: Anthropic,
  model: string
): Promise<Outline> {
  const digest = corpus.map(sermonDigest).join('\n\n')

  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: 4000,
      tools: [OUTLINE_TOOL],
      tool_choice: { type: 'tool', name: 'emit_outline' },
      messages: [
        {
          role: 'user',
          content: `You are compiling a book on "${topic}" for ${config.MINISTRY_NAME}, drawn ENTIRELY from the sermon material below — never from general knowledge. Design a coherent book: a compelling title and an ordered set of chapters.

Right-size the number of chapters to the DEPTH of the available material — do NOT pad. A thin topic with little material may only warrant 2–4 chapters; a rich one can have more, up to a hard maximum of ${MAX_BOOK_CHAPTERS}. Every chapter must be substantively supported by the sermons listed — never invent chapters to hit a number.

For each chapter give a heading, a one-or-two-sentence focus, and the ids of the sermons whose material grounds it (choose only from the ids listed). Then call emit_outline.

Sermon material:
${digest}`,
        },
      ],
    })
  )

  if (response.stop_reason === 'max_tokens') {
    throw new Error('Outline response was truncated at max_tokens')
  }
  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Expected an emit_outline tool_use, got stop_reason=${response.stop_reason}`)
  }

  const input = toolUse.input as { title?: string; chapters?: OutlineChapter[] }
  const validIds = new Set(corpus.map((e) => e.sermon.id))
  const chapters = (input.chapters ?? [])
    .slice(0, MAX_BOOK_CHAPTERS)
    .map((ch) => ({
      heading: (ch.heading ?? '').trim() || 'Untitled chapter',
      focus: (ch.focus ?? '').trim(),
      sermon_ids: Array.isArray(ch.sermon_ids) ? ch.sermon_ids.filter((id) => validIds.has(id)) : [],
    }))
  if (chapters.length === 0) {
    throw new Error('Outline produced no chapters')
  }
  return { title: (input.title ?? '').trim() || `On ${topic}`, chapters }
}

// Assemble the grounding excerpts for one chapter, capped to keep the input
// bounded. Falls back to the whole corpus if the outline didn't pin sermons.
function gatherChapterMaterial(chapter: OutlineChapter, corpusById: Map<number, CorpusEntry>): string {
  const ids = chapter.sermon_ids.length > 0 ? chapter.sermon_ids : [...corpusById.keys()]
  let material = ''
  for (const id of ids) {
    const entry = corpusById.get(id)
    if (!entry) continue
    const s = entry.sermon
    const cite = `${s.title} (${s.speaker ?? 'Unknown'}, ${formatSermonDate(s.date)})`
    for (const c of entry.chunks) {
      const block = `From "${cite}" — ${c.section_name}:\n${c.content}\n\n`
      if (material.length + block.length > MAX_CHAPTER_SOURCE_CHARS) break
      material += block
    }
    if (material.length >= MAX_CHAPTER_SOURCE_CHARS) break
  }
  return material.trim()
}

async function draftChapter(
  topic: string,
  bookTitle: string,
  chapter: OutlineChapter,
  corpusById: Map<number, CorpusEntry>,
  anthropic: Anthropic,
  model: string
): Promise<string> {
  const material = gatherChapterMaterial(chapter, corpusById)

  // Stable across every chapter of this book, so it sits behind the
  // cache_control breakpoint; the per-chapter excerpts go in the user turn.
  const system = [
    `You are writing a book titled "${bookTitle}" on the subject of "${topic}" for ${config.MINISTRY_NAME}.`,
    'Write each chapter ENTIRELY from the sermon excerpts provided — never add teaching, doctrine, scripture interpretation, or claims not grounded in those excerpts. This is a faithful synthesis of the ministry\'s own preaching, not general knowledge.',
    'Write flowing prose across several paragraphs. Do NOT restate the chapter title or use markdown headings — the heading is added separately. Attribute ideas inline to the sermons you draw from, e.g. "(Sermon Title, Date)". Separate paragraphs with a blank line.',
  ].join('\n')

  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Chapter: ${chapter.heading}
Focus: ${chapter.focus}

Write this chapter using only the following sermon excerpts:

${material || '(no excerpts available)'}`,
        },
      ],
    })
  )

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return text || '(This chapter could not be drafted from the available sermon material.)'
}

/**
 * Generate a book draft on `topic` from already-ingested sermon material and
 * persist it (book row + chapters). Runs as a background job: retrieving →
 * outlining → drafting → rendering. The book row (created by the caller) is
 * marked done on success and failed on any error. Returns a structured result
 * the queue maps to the job's terminal state.
 */
export async function generateBook(
  req: BookRequest,
  anthropic: Anthropic,
  ctx: JobContext
): Promise<BookResult> {
  const model = config.BOOK_MODEL ?? config.CLAUDE_MODEL

  try {
    ctx.setPhase('retrieving')
    const sermons = resolveBookCorpus(req.topic)
    if (sermons.length === 0) {
      markBookFailed(req.bookId)
      return { status: 'error', message: `No sermons found on “${req.topic}” to draw a book from` }
    }

    const corpus: CorpusEntry[] = sermons.map((s) => ({ sermon: s, chunks: getChunksBySermonId(s.id) }))
    const corpusById = new Map(corpus.map((e) => [e.sermon.id, e]))
    const bookSources: BookSource[] = sermons.map((s) => ({
      title: s.title,
      date: s.date,
      speaker: s.speaker,
    }))

    ctx.setPhase('outlining')
    const outline = await generateOutline(req.topic, corpus, anthropic, model)
    setBookTitleAndSources(req.bookId, outline.title, bookSources)
    // Publish the planned chapter count so the status view can show progress.
    setBookChapterCount(req.bookId, outline.chapters.length)

    ctx.setPhase('drafting')
    // Persist each chapter as it is drafted (not in one batch at the end) so the
    // status table shows N of M chapters generated while the job runs.
    for (let i = 0; i < outline.chapters.length; i++) {
      const ch = outline.chapters[i]
      logger.debug(`Book ${req.bookId}: drafting chapter ${i + 1}/${outline.chapters.length} — ${ch.heading}`)
      const body = await draftChapter(req.topic, outline.title, ch, corpusById, anthropic, model)
      addBookChapter(req.bookId, { idx: i, heading: ch.heading, body })
    }

    ctx.setPhase('rendering')
    markBookDone(req.bookId)

    return {
      status: 'ok',
      message: `Generated “${outline.title}” — ${outline.chapters.length} chapter(s) from ${sermons.length} sermon(s)`,
    }
  } catch (err) {
    markBookFailed(req.bookId)
    logger.error(`Book ${req.bookId} generation failed: ${errMsg(err)}`)
    return { status: 'error', message: `Book generation failed: ${errMsg(err)}` }
  }
}
