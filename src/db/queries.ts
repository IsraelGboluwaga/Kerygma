import { getDb } from './connection.js'

// FTS5 has its own query syntax — special characters like ", *, (, ) cause parse
// errors if passed raw. Split into tokens and double-quote each so the query is
// treated as a set of exact-token matches (AND semantics).
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/['"*()\^~\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`)
  return tokens.length > 0 ? tokens.join(' ') : '""'
}

export interface SermonRow {
  id: number
  video_id: string
  title: string
  date: string
  url: string
  webpage_url: string | null
  speaker: string | null
  duration: number | null
  tags: string | null
  created_at: string
}

export interface ChunkRow {
  id: number
  sermon_id: number
  section_name: string
  content: string
  timestamp_start: number
  timestamp_end: number
  topics: string | null
  summary: string | null
  embedding: Buffer | null
}

export interface ChunkWithSermon extends ChunkRow {
  sermon_title: string
  date: string
  url: string
  speaker: string | null
}

export interface SaveSermonInput {
  video_id: string
  title: string
  date: string
  url: string
  webpage_url?: string
  speaker?: string
  duration?: number
  tags?: string[]
}

export interface SaveChunkInput {
  section_name: string
  content: string
  timestamp_start: number
  timestamp_end: number
  topics?: string[]
  summary?: string
  embedding?: Buffer
}

export function saveSermon(data: SaveSermonInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO sermons (video_id, title, date, url, webpage_url, speaker, duration, tags)
       VALUES (@video_id, @title, @date, @url, @webpage_url, @speaker, @duration, @tags)`
    )
    .run({
      video_id: data.video_id,
      title: data.title,
      date: data.date,
      url: data.url,
      webpage_url: data.webpage_url ?? null,
      speaker: data.speaker ?? null,
      duration: data.duration ?? null,
      tags: data.tags ? JSON.stringify(data.tags) : null,
    })
  return result.lastInsertRowid as number
}

export function saveChunks(sermonId: number, chunks: SaveChunkInput[]): void {
  const database = getDb()
  const insert = database.prepare(
    `INSERT INTO chunks
       (sermon_id, section_name, content, timestamp_start, timestamp_end, topics, summary, embedding)
     VALUES
       (@sermon_id, @section_name, @content, @timestamp_start, @timestamp_end, @topics, @summary, @embedding)`
  )

  const insertMany = database.transaction((rows: SaveChunkInput[]) => {
    for (const c of rows) {
      insert.run({
        sermon_id: sermonId,
        section_name: c.section_name,
        content: c.content,
        timestamp_start: c.timestamp_start,
        timestamp_end: c.timestamp_end,
        topics: c.topics ? JSON.stringify(c.topics) : null,
        summary: c.summary ?? null,
        embedding: c.embedding ?? null,
      })
    }
  })

  insertMany(chunks)
}

export function getSermonByVideoId(videoId: string): SermonRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM sermons WHERE video_id = ?`)
      .get(videoId) as SermonRow | undefined) ?? null
  )
}

export function getSermonsByDate(date: string): SermonRow[] {
  return getDb()
    .prepare(`SELECT * FROM sermons WHERE date LIKE ? ORDER BY date DESC`)
    .all(`${date}%`) as SermonRow[]
}

export function getChunksBySermonId(sermonId: number): ChunkRow[] {
  return getDb()
    .prepare(`SELECT * FROM chunks WHERE sermon_id = ? ORDER BY timestamp_start`)
    .all(sermonId) as ChunkRow[]
}

export function searchChunks(query: string, limit = 10): ChunkWithSermon[] {
  return getDb()
    .prepare(
      `SELECT c.*, s.title AS sermon_title, s.date, s.url, s.speaker
       FROM chunks_fts fts
       JOIN chunks c ON c.id = fts.rowid
       JOIN sermons s ON s.id = c.sermon_id
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(sanitizeFtsQuery(query), limit) as ChunkWithSermon[]
}

export function listSermons(limit = 20): SermonRow[] {
  return getDb()
    .prepare(`SELECT * FROM sermons ORDER BY date DESC LIMIT ?`)
    .all(limit) as SermonRow[]
}

export function getNearestSermonByDate(date: string): SermonRow | null {
  // Pad partial dates so julianday() gets a valid input
  const padded =
    date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date
  return (
    (getDb()
      .prepare(
        `SELECT * FROM sermons ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1`
      )
      .get(padded) as SermonRow | undefined) ?? null
  )
}

export function getSpeakersMatchingFilter(filter: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT speaker FROM sermons
       WHERE speaker IS NOT NULL AND LOWER(speaker) LIKE LOWER(?)
       ORDER BY speaker`
    )
    .all(`%${filter}%`) as { speaker: string }[]
  return rows.map((r) => r.speaker)
}
