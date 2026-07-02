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

// Build an FTS query that matches a subject only in the Claude-derived `topics`
// and `summary` columns (not raw `content`). A term appearing there means the
// section is *about* that subject — not just mentioning the word in passing,
// which for a common word like "faith" would otherwise match almost everything.
// Multiple tokens are ANDed for precision (e.g. "spiritual growth").
function topicMatchQuery(term: string): string | null {
  const tokens = term
    .replace(/['"*()\^~\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t.toLowerCase()))
    .map((t) => `"${t}"`)
  if (tokens.length === 0) return null
  return `{topics summary} : (${tokens.join(' AND ')})`
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
  excerpt: string | null
  theme_id: number | null
  theme: string | null  // joined theme name (themes.name), null when no theme
  description: string | null
  ingestion_status: string
  transcription: string | null
  created_at: string
}

export interface ThemeRow {
  id: number
  theme_id: string  // upstream API _id — stable across name changes
  name: string
  slug: string | null
  created_at: string
}

export interface ThemeInput {
  themeId: string   // upstream API _id
  name: string
  slug?: string
}

export interface TranscriptionRow {
  id: number
  sermon_id: number
  transcript: string
  segments: string  // JSON-encoded TranscriptSegment[]
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
  theme: string | null
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
  excerpt?: string
  theme?: ThemeInput
  description?: string
}

export interface InsertPartialSermonInput extends SaveSermonInput {
  duration: number  // required — known after transcription
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

/**
 * Insert a theme (or update its name/slug if the upstream id is already known)
 * and return its local primary key. Keyed on the upstream `theme_id` so the
 * mapping survives theme renames.
 */
export function upsertTheme(theme: ThemeInput): number {
  const database = getDb()
  database
    .prepare(
      `INSERT INTO themes (theme_id, name, slug)
       VALUES (@theme_id, @name, @slug)
       ON CONFLICT(theme_id) DO UPDATE SET name = excluded.name, slug = excluded.slug`
    )
    .run({ theme_id: theme.themeId, name: theme.name, slug: theme.slug ?? null })
  const row = database
    .prepare(`SELECT id FROM themes WHERE theme_id = ?`)
    .get(theme.themeId) as { id: number }
  return row.id
}

function insertSermonRow(data: SaveSermonInput, status: 'done' | 'transcribed'): number {
  const themeId = data.theme ? upsertTheme(data.theme) : null
  const result = getDb()
    .prepare(
      `INSERT INTO sermons (video_id, title, date, download_url, webpage_url, speaker, duration, tags, excerpt, theme_id, description, ingestion_status)
       VALUES (@video_id, @title, @date, @download_url, @webpage_url, @speaker, @duration, @tags, @excerpt, @theme_id, @description, @status)`
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
      excerpt: data.excerpt ?? null,
      theme_id: themeId,
      description: data.description ?? null,
      status,
    })
  return result.lastInsertRowid as number
}

export function saveSermon(data: SaveSermonInput): number {
  return insertSermonRow(data, 'done')
}

export function insertPartialSermon(data: InsertPartialSermonInput): number {
  return insertSermonRow(data, 'transcribed')
}

export function completeSermon(id: number): void {
  getDb()
    .prepare(`UPDATE sermons SET ingestion_status = 'done' WHERE id = ?`)
    .run(id)
}

export function insertTranscription(
  sermonId: number,
  transcript: string,
  segments: string
): void {
  getDb()
    .prepare(
      `INSERT INTO transcriptions (sermon_id, transcript, segments)
       VALUES (?, ?, ?)`
    )
    .run(sermonId, transcript, segments)
}

export function getTranscriptionBySermonId(sermonId: number): TranscriptionRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM transcriptions WHERE sermon_id = ?`)
      .get(sermonId) as TranscriptionRow | undefined) ?? null
  )
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

// Base SELECT for sermon rows — LEFT JOINs the theme name so callers get a
// human-readable `theme` alongside the raw `theme_id` FK.
const SERMON_SELECT = `SELECT s.*, t.name AS theme FROM sermons s LEFT JOIN themes t ON t.id = s.theme_id`

export function getSermonByVideoId(videoId: string): SermonRow | null {
  return (
    (getDb()
      .prepare(`${SERMON_SELECT} WHERE s.video_id = ?`)
      .get(videoId) as SermonRow | undefined) ?? null
  )
}

/**
 * All video_ids that are fully ingested (`ingestion_status = 'done'`), as a Set
 * for O(1) membership checks. Loaded once per API sync so the scheduler can skip
 * already-ingested sermons without a per-sermon row lookup. Partial rows
 * (e.g. 'transcribed') are intentionally excluded so they get re-enqueued and
 * resume from the stored transcript.
 */
export function getDoneVideoIds(): Set<string> {
  const rows = getDb()
    .prepare(`SELECT video_id FROM sermons WHERE ingestion_status = 'done'`)
    .all() as { video_id: string }[]
  return new Set(rows.map((r) => r.video_id))
}

export function getSermonsByDate(date: string): SermonRow[] {
  return getDb()
    .prepare(`${SERMON_SELECT} WHERE s.date LIKE ? AND s.ingestion_status = 'done' ORDER BY s.date DESC`)
    .all(`${date}%`) as SermonRow[]
}

export function getSermonsByTheme(themeId: string): SermonRow[] {
  return getDb()
    .prepare(
      `${SERMON_SELECT} WHERE t.theme_id = ? AND s.ingestion_status = 'done' ORDER BY s.date DESC`
    )
    .all(themeId) as SermonRow[]
}

// Resolve a free-text theme term (e.g. "faith") to its sermons via a substring
// match on the theme name — so "faith" still matches a "Faith Foundations" theme.
export function getSermonsByThemeName(name: string): SermonRow[] {
  return getDb()
    .prepare(
      `${SERMON_SELECT} WHERE t.name IS NOT NULL AND LOWER(t.name) LIKE LOWER(?)
       AND s.ingestion_status = 'done' ORDER BY s.date DESC`
    )
    .all(`%${name}%`) as SermonRow[]
}

// Distinct sermons whose chunks match an FTS query, ranked by best chunk relevance.
// Used as the keyword fallback when a theme term isn't a formal theme name.
export function searchSermons(query: string, limit = 50): SermonRow[] {
  return getDb()
    .prepare(
      `SELECT s.*, t.name AS theme
       FROM sermons s
       LEFT JOIN themes t ON t.id = s.theme_id
       JOIN (
         SELECT c.sermon_id AS sid, MIN(fts.rank) AS best_rank
         FROM chunks_fts fts
         JOIN chunks c ON c.id = fts.rowid
         WHERE chunks_fts MATCH ?
         GROUP BY c.sermon_id
       ) m ON m.sid = s.id
       WHERE s.ingestion_status = 'done'
       ORDER BY m.best_rank
       LIMIT ?`
    )
    .all(sanitizeFtsQuery(query), limit) as SermonRow[]
}

// Sermons that are genuinely *about* a subject, ranked by relevance density —
// the share of the sermon's sections whose Claude-derived topics/summary match.
// A sermon predominantly about faith outranks one that mentions it once; a
// sermon that only references the word in passing (content only) is excluded.
export function searchSermonsByTopic(term: string, limit = 50): SermonRow[] {
  const match = topicMatchQuery(term)
  if (!match) return []
  return getDb()
    .prepare(
      `SELECT s.*, th.name AS theme
       FROM sermons s
       LEFT JOIN themes th ON th.id = s.theme_id
       JOIN (
         SELECT c.sermon_id AS sid,
                COUNT(*) AS topic_hits,
                COUNT(*) * 1.0 /
                  (SELECT COUNT(*) FROM chunks cc WHERE cc.sermon_id = c.sermon_id) AS density
         FROM chunks_fts fts
         JOIN chunks c ON c.id = fts.rowid
         WHERE chunks_fts MATCH ?
         GROUP BY c.sermon_id
       ) m ON m.sid = s.id
       WHERE s.ingestion_status = 'done'
       ORDER BY m.density DESC, m.topic_hits DESC, s.date DESC
       LIMIT ?`
    )
    .all(match, limit) as SermonRow[]
}

// Find sermons whose title matches the given text (case-insensitive substring).
// Used by the chat's find_sermon tool to resolve a sermon a member names so we
// can hand back its details — notably the YouTube link stored in webpage_url.
export function findSermonsByTitle(query: string, limit = 10): SermonRow[] {
  return getDb()
    .prepare(
      `SELECT s.*, t.name AS theme
       FROM sermons s
       LEFT JOIN themes t ON t.id = s.theme_id
       WHERE s.ingestion_status = 'done'
         AND LOWER(s.title) LIKE '%' || LOWER(?) || '%'
       ORDER BY s.date DESC
       LIMIT ?`
    )
    .all(query, limit) as SermonRow[]
}

export function listThemes(): ThemeRow[] {
  return getDb().prepare(`SELECT * FROM themes ORDER BY name`).all() as ThemeRow[]
}

export function getChunksBySermonId(sermonId: number): ChunkRow[] {
  return getDb()
    .prepare(`SELECT * FROM chunks WHERE sermon_id = ? ORDER BY timestamp_start`)
    .all(sermonId) as ChunkRow[]
}

export function searchChunks(query: string, limit = 10): ChunkWithSermon[] {
  return getDb()
    .prepare(
      `SELECT c.*, s.title AS sermon_title, s.date, s.download_url, s.webpage_url, s.speaker, t.name AS theme
       FROM chunks_fts fts
       JOIN chunks c ON c.id = fts.rowid
       JOIN sermons s ON s.id = c.sermon_id
       LEFT JOIN themes t ON t.id = s.theme_id
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(sanitizeFtsQuery(query), limit) as ChunkWithSermon[]
}

export function listSermons(limit = 20): SermonRow[] {
  return getDb()
    .prepare(`${SERMON_SELECT} WHERE s.ingestion_status = 'done' ORDER BY s.date DESC LIMIT ?`)
    .all(limit) as SermonRow[]
}

export function getNearestSermonByDate(date: string): SermonRow | null {
  // Pad partial dates so julianday() gets a valid input
  const padded =
    date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date
  return (
    (getDb()
      .prepare(
        `${SERMON_SELECT} WHERE s.ingestion_status = 'done' ORDER BY ABS(julianday(s.date) - julianday(?)) LIMIT 1`
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
  phase: string | null
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
  phase?: string
  message?: string
  error?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}): void {
  getDb()
    .prepare(
      `INSERT INTO jobs (id, title, download_url, payload, status, phase, message, error, created_at, started_at, completed_at)
       VALUES (@id, @title, @download_url, @payload, @status, @phase, @message, @error, @created_at, @started_at, @completed_at)
       ON CONFLICT(id) DO UPDATE SET
         status       = excluded.status,
         phase        = excluded.phase,
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
      phase: job.phase ?? null,
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

// ── Missing sermons ──────────────────────────────────────────────────────────

export type MissingSermonKind = 'no_audio' | 'too_long' | 'timeout' | 'error'

export interface MissingSermonRow {
  id: number
  video_id: string
  title: string
  date: string | null
  download_url: string | null
  webpage_url: string | null
  speaker: string | null
  theme: string | null
  kind: MissingSermonKind
  reason: string
  created_at: string
  updated_at: string
}

export interface RecordMissingSermonInput {
  video_id: string         // stable identity so retries upsert instead of duplicating
  title: string
  date?: string
  download_url?: string
  webpage_url?: string
  speaker?: string
  theme?: string
  kind: MissingSermonKind
  reason: string
}

export function recordMissingSermon(data: RecordMissingSermonInput): void {
  getDb()
    .prepare(
      `INSERT INTO missing_sermons (video_id, title, date, download_url, webpage_url, speaker, theme, kind, reason)
       VALUES (@video_id, @title, @date, @download_url, @webpage_url, @speaker, @theme, @kind, @reason)
       ON CONFLICT(video_id) DO UPDATE SET
         title        = excluded.title,
         date         = excluded.date,
         download_url = excluded.download_url,
         webpage_url  = excluded.webpage_url,
         speaker      = excluded.speaker,
         theme        = excluded.theme,
         kind         = excluded.kind,
         reason       = excluded.reason,
         updated_at   = datetime('now')`
    )
    .run({
      video_id: data.video_id,
      title: data.title,
      date: data.date ?? null,
      download_url: data.download_url ?? null,
      webpage_url: data.webpage_url ?? null,
      speaker: data.speaker ?? null,
      theme: data.theme ?? null,
      kind: data.kind,
      reason: data.reason,
    })
}

export function listMissingSermons(limit = 50): MissingSermonRow[] {
  return getDb()
    .prepare(`SELECT * FROM missing_sermons ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as MissingSermonRow[]
}

/** Video IDs already recorded as missing for the given kind — used by the sync
 * to skip sermons it knows will fail again (e.g. `no_audio`). */
export function getMissingVideoIdsByKind(kind: MissingSermonKind): Set<string> {
  const rows = getDb()
    .prepare(`SELECT video_id FROM missing_sermons WHERE kind = ?`)
    .all(kind) as { video_id: string }[]
  return new Set(rows.map((r) => r.video_id))
}

/** Removes a missing-sermon entry once it has been successfully ingested. */
export function removeMissingSermon(videoId: string): void {
  getDb().prepare(`DELETE FROM missing_sermons WHERE video_id = ?`).run(videoId)
}

// ── Config key-value store ───────────────────────────────────────────────────

export function getConfig(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM config WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value)
}

export function countSermons(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM sermons WHERE ingestion_status = 'done'`)
    .get() as { count: number }
  return row.count
}

export function getSpeakersMatchingFilter(filter: string): string[] {
  const canonical = resolveAliasToCanonical(filter)
  const effectiveFilter = canonical ?? filter
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT speaker FROM sermons
       WHERE speaker IS NOT NULL AND ingestion_status = 'done' AND LOWER(speaker) LIKE LOWER(?)
       ORDER BY speaker`
    )
    .all(`%${effectiveFilter}%`) as { speaker: string }[]
  return rows.map((r) => r.speaker)
}

export function resolveAliasToCanonical(filter: string): string | null {
  const row = getDb()
    .prepare(`SELECT canonical_name FROM speaker_aliases WHERE alias = LOWER(?)`)
    .get(filter.trim()) as { canonical_name: string } | undefined
  return row?.canonical_name ?? null
}

export function upsertSpeakerAlias(alias: string, canonicalName: string): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO speaker_aliases (alias, canonical_name) VALUES (LOWER(?), ?)`)
    .run(alias.trim(), canonicalName)
}

export function deleteSpeakerAlias(alias: string): void {
  getDb()
    .prepare(`DELETE FROM speaker_aliases WHERE alias = LOWER(?)`)
    .run(alias.trim())
}

export function listSpeakerAliases(): { alias: string; canonicalName: string }[] {
  const rows = getDb()
    .prepare(`SELECT alias, canonical_name FROM speaker_aliases ORDER BY canonical_name, alias`)
    .all() as { alias: string; canonical_name: string }[]
  return rows.map((r) => ({ alias: r.alias, canonicalName: r.canonical_name }))
}

// ── Book drafts ──────────────────────────────────────────────────────────────

export type BookStatus = 'generating' | 'done' | 'failed'

export interface BookSource {
  title: string
  date: string
  speaker: string | null
}

export interface BookRow {
  id: number
  topic: string
  title: string | null
  status: BookStatus
  sources: string | null  // JSON-encoded BookSource[]
  chapter_count: number | null  // planned chapters, set once the outline is known
  created_at: string
}

export interface BookChapterRow {
  id: number
  book_id: number
  idx: number
  heading: string
  body: string
}

export interface BookChapterInput {
  idx: number
  heading: string
  body: string
}

/** Create a book row in the 'generating' state and return its id. */
export function insertBook(topic: string): number {
  const result = getDb()
    .prepare(`INSERT INTO books (topic, status) VALUES (?, 'generating')`)
    .run(topic)
  return result.lastInsertRowid as number
}

/** Record the model-chosen title and the sermons the draft was grounded in. */
export function setBookTitleAndSources(id: number, title: string, sources: BookSource[]): void {
  getDb()
    .prepare(`UPDATE books SET title = ?, sources = ? WHERE id = ?`)
    .run(title, JSON.stringify(sources), id)
}

/** Record the planned chapter count (once the outline is known) for progress display. */
export function setBookChapterCount(id: number, count: number): void {
  getDb().prepare(`UPDATE books SET chapter_count = ? WHERE id = ?`).run(count, id)
}

/** Append a single chapter. Chapters are inserted as they are drafted so the
 *  status view can show live progress (N of M chapters generated). */
export function addBookChapter(bookId: number, chapter: BookChapterInput): void {
  getDb()
    .prepare(`INSERT INTO book_chapters (book_id, idx, heading, body) VALUES (?, ?, ?, ?)`)
    .run(bookId, chapter.idx, chapter.heading, chapter.body)
}

/** Number of chapters drafted so far for a book. */
export function getBookChapterCount(bookId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM book_chapters WHERE book_id = ?`)
    .get(bookId) as { count: number }
  return row.count
}

export function markBookDone(id: number): void {
  getDb().prepare(`UPDATE books SET status = 'done' WHERE id = ?`).run(id)
}

export function markBookFailed(id: number): void {
  getDb().prepare(`UPDATE books SET status = 'failed' WHERE id = ?`).run(id)
}

export function getBook(id: number): BookRow | null {
  return (
    (getDb().prepare(`SELECT * FROM books WHERE id = ?`).get(id) as BookRow | undefined) ?? null
  )
}

export function getBookChapters(bookId: number): BookChapterRow[] {
  return getDb()
    .prepare(`SELECT * FROM book_chapters WHERE book_id = ? ORDER BY idx`)
    .all(bookId) as BookChapterRow[]
}

export function listBooks(limit = 50): BookRow[] {
  return getDb()
    .prepare(`SELECT * FROM books ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(limit) as BookRow[]
}
