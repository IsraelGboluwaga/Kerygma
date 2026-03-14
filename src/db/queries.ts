import { getDb } from './connection.js'

// FTS5 has its own query syntax — special characters like ", *, (, ) cause parse
// errors if passed raw. Split into tokens and double-quote each so the query is
// treated as a set of exact-token matches (AND semantics).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'was', 'are', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'she', 'his', 'her', 'they', 'their', 'them',
  'about', 'say', 'said', 'tell', 'told', 'know', 'think',
])

function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/['"*()\^~\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t.toLowerCase()))
    .map((t) => `"${t}"`)
  return tokens.length > 0 ? tokens.join(' OR ') : '""'
}

export interface SermonRow {
  id: number
  video_id: string
  title: string
  date: string
  download_url: string
  webpage_url: string | null
  speaker: string | null
  duration: number | null
  tags: string | null
  series: string | null
  ingestion_status: string
  transcription: string | null
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
  download_url: string
  webpage_url: string | null
  speaker: string | null
  series: string | null
}

export interface SaveSermonInput {
  video_id: string
  title: string
  date: string
  download_url: string
  webpage_url?: string
  speaker?: string
  duration?: number
  tags?: string[]
  series?: string
}

export interface InsertPartialSermonInput extends SaveSermonInput {
  duration: number          // required — known after transcription
  transcription: string     // JSON-encoded TranscriptSegment[]
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
      `INSERT INTO sermons (video_id, title, date, download_url, webpage_url, speaker, duration, tags, series, ingestion_status)
       VALUES (@video_id, @title, @date, @download_url, @webpage_url, @speaker, @duration, @tags, @series, 'done')`
    )
    .run({
      video_id: data.video_id,
      title: data.title,
      date: data.date,
      download_url: data.download_url,
      webpage_url: data.webpage_url ?? null,
      speaker: data.speaker ?? null,
      duration: data.duration ?? null,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      series: data.series ?? null,
    })
  return result.lastInsertRowid as number
}

export function insertPartialSermon(data: InsertPartialSermonInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO sermons (video_id, title, date, download_url, webpage_url, speaker, duration, tags, series, ingestion_status, transcription)
       VALUES (@video_id, @title, @date, @download_url, @webpage_url, @speaker, @duration, @tags, @series, 'transcribed', @transcription)`
    )
    .run({
      video_id: data.video_id,
      title: data.title,
      date: data.date,
      download_url: data.download_url,
      webpage_url: data.webpage_url ?? null,
      speaker: data.speaker ?? null,
      duration: data.duration,
      tags: data.tags ? JSON.stringify(data.tags) : null,
      series: data.series ?? null,
      transcription: data.transcription,
    })
  return result.lastInsertRowid as number
}

export function completeSermon(id: number): void {
  getDb()
    .prepare(
      `UPDATE sermons SET ingestion_status = 'done', transcription = NULL WHERE id = ?`
    )
    .run(id)
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
    .prepare(`SELECT * FROM sermons WHERE date LIKE ? AND ingestion_status = 'done' ORDER BY date DESC`)
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
      `SELECT c.*, s.title AS sermon_title, s.date, s.download_url, s.webpage_url, s.speaker, s.series
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
    .prepare(`SELECT * FROM sermons WHERE ingestion_status = 'done' ORDER BY date DESC LIMIT ?`)
    .all(limit) as SermonRow[]
}

export function getNearestSermonByDate(date: string): SermonRow | null {
  // Pad partial dates so julianday() gets a valid input
  const padded =
    date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date
  return (
    (getDb()
      .prepare(
        `SELECT * FROM sermons WHERE ingestion_status = 'done' ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1`
      )
      .get(padded) as SermonRow | undefined) ?? null
  )
}

// ── Job persistence ─────────────────────────────────────────────────────────

export interface JobRow {
  id: string
  title: string | null
  download_url: string | null
  payload: string | null
  status: string
  message: string | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export function upsertJob(job: {
  id: string
  title?: string
  download_url?: string
  payload?: string
  status: string
  message?: string
  error?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, title, download_url, payload, status, message, error, created_at, started_at, completed_at)
       VALUES (@id, @title, @download_url, @payload, @status, @message, @error, @created_at, @started_at, @completed_at)
       ON CONFLICT(id) DO UPDATE SET
         status       = excluded.status,
         message      = excluded.message,
         error        = excluded.error,
         started_at   = excluded.started_at,
         completed_at = excluded.completed_at`
    )
    .run({
      id: job.id,
      title: job.title ?? null,
      download_url: job.download_url ?? null,
      payload: job.payload ?? null,
      status: job.status,
      message: job.message ?? null,
      error: job.error ?? null,
      created_at: job.createdAt.toISOString(),
      started_at: job.startedAt?.toISOString() ?? null,
      completed_at: job.completedAt?.toISOString() ?? null,
    })
}

export function getJobRow(id: string): JobRow | null {
  return (
    (getDb().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined) ?? null
  )
}

export function listRecentJobRows(limit = 50): JobRow[] {
  return getDb()
    .prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as JobRow[]
}

export function failStaleJobs(): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = 'failed', error = 'Server restarted while job was running'
       WHERE status IN ('queued', 'running')`
    )
    .run()
}

export function getSpeakersMatchingFilter(filter: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT speaker FROM sermons
       WHERE speaker IS NOT NULL AND ingestion_status = 'done' AND LOWER(speaker) LIKE LOWER(?)
       ORDER BY speaker`
    )
    .all(`%${filter}%`) as { speaker: string }[]
  return rows.map((r) => r.speaker)
}
