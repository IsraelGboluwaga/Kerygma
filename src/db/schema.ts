import type Database from 'better-sqlite3'

export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id   TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      slug       TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sermons (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id         TEXT UNIQUE NOT NULL,
      title            TEXT NOT NULL,
      date             TEXT NOT NULL,
      download_url     TEXT NOT NULL,
      webpage_url      TEXT,
      speaker          TEXT,
      duration         INTEGER,
      tags             TEXT,
      excerpt          TEXT,
      theme_id         INTEGER REFERENCES themes(id),
      description      TEXT,
      ingestion_status TEXT NOT NULL DEFAULT 'done',
      transcription    TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transcriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id  INTEGER UNIQUE NOT NULL REFERENCES sermons(id),
      transcript TEXT NOT NULL,
      segments   TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id       INTEGER NOT NULL REFERENCES sermons(id),
      section_name    TEXT NOT NULL,
      content         TEXT NOT NULL,
      timestamp_start REAL NOT NULL,
      timestamp_end   REAL NOT NULL,
      topics          TEXT,
      summary         TEXT,
      embedding       BLOB -- 384-dim Float32 vector, generated but not queried yet — kept for a future vector-search path alongside FTS5
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      download_url TEXT,
      payload      TEXT,
      status       TEXT NOT NULL DEFAULT 'queued',
      phase        TEXT,
      message      TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      completed_at TEXT
    );

    -- Sermons that could not be ingested (no audio path, too long, timeout, etc.)
    -- so an admin can review them in the DB browser. Keyed by video_id (the API's
    -- stable _id) so retries upsert. Server-restart failures are NOT recorded here.
    CREATE TABLE IF NOT EXISTS missing_sermons (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id     TEXT UNIQUE NOT NULL,
      title        TEXT NOT NULL,
      date         TEXT,
      download_url TEXT,
      webpage_url  TEXT,
      speaker      TEXT,
      theme        TEXT,
      kind         TEXT NOT NULL DEFAULT 'error',  -- no_audio | too_long | timeout | error
      reason       TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sermon_date         ON sermons(date);
    CREATE INDEX IF NOT EXISTS idx_sermon_video_id     ON sermons(video_id);
    CREATE INDEX IF NOT EXISTS idx_chunk_sermon_id     ON chunks(sermon_id);
    CREATE INDEX IF NOT EXISTS idx_transcription_sermon ON transcriptions(sermon_id);
    CREATE INDEX IF NOT EXISTS idx_job_created       ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_missing_updated   ON missing_sermons(updated_at DESC);

    -- Maps lowercased aliases/nicknames to the canonical speaker name stored in sermons.speaker.
    -- Checked before the LIKE fallback in speaker resolution so short/informal names work.
    CREATE TABLE IF NOT EXISTS speaker_aliases (
      alias          TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL
    );

    -- Book drafts generated from sermon material on a topic. Chapters live in a
    -- separate one-to-many table so a book row stays small and listable. The
    -- sources column is a JSON array of the sermons the draft was grounded in
    -- (rendered on the PDF sources page). The status column gates the download
    -- endpoint until it is 'done'.
    CREATE TABLE IF NOT EXISTS books (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      topic         TEXT NOT NULL,
      title         TEXT,
      status        TEXT NOT NULL DEFAULT 'generating',  -- generating | done | failed
      sources       TEXT,
      chapter_count INTEGER,                             -- planned chapters, set after outlining
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_chapters (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id),
      idx     INTEGER NOT NULL,
      heading TEXT NOT NULL,
      body    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_book_created       ON books(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_book_chapter_book  ON book_chapters(book_id);

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      summary,
      topics,
      content_rowid='id',
      content='chunks'
    );

    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, summary, topics)
      VALUES (new.id, new.content, new.summary, new.topics);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, summary, topics)
      VALUES ('delete', old.id, old.content, old.summary, old.topics);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, summary, topics)
      VALUES ('delete', old.id, old.content, old.summary, old.topics);
      INSERT INTO chunks_fts(rowid, content, summary, topics)
      VALUES (new.id, new.content, new.summary, new.topics);
    END;
  `)

  // Migration shims — allow existing Python-created DBs to keep working
  const existingSermonCols = db
    .prepare(`PRAGMA table_info(sermons)`)
    .all() as Array<{ name: string }>
  const sermonColNames = new Set(existingSermonCols.map((c) => c.name))

  if (!sermonColNames.has('webpage_url')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN webpage_url TEXT`)
  }
  if (!sermonColNames.has('tags')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN tags TEXT`)
  }
  // Rename url → download_url (SQLite 3.25+ supports RENAME COLUMN)
  if (sermonColNames.has('url') && !sermonColNames.has('download_url')) {
    db.exec(`ALTER TABLE sermons RENAME COLUMN url TO download_url`)
  }
  if (!sermonColNames.has('excerpt')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN excerpt TEXT`)
  }
  if (!sermonColNames.has('theme_id')) {
    // Nullable FK with no default — safe to add via ALTER TABLE in SQLite.
    // The legacy `series` TEXT column (if present) is left in place but unused.
    db.exec(`ALTER TABLE sermons ADD COLUMN theme_id INTEGER REFERENCES themes(id)`)
  }
  // Index must come after migration shim — existing DBs won't have theme_id yet when
  // the main db.exec() block runs, causing "no such column" on the CREATE INDEX.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sermon_theme ON sermons(theme_id)`)
  if (!sermonColNames.has('ingestion_status')) {
    // Existing rows are fully ingested, so default them to 'done'
    db.exec(`ALTER TABLE sermons ADD COLUMN ingestion_status TEXT NOT NULL DEFAULT 'done'`)
  }
  if (!sermonColNames.has('transcription')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN transcription TEXT`)
  }
  if (!sermonColNames.has('description')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN description TEXT`)
  }

  const existingChunkCols = db
    .prepare(`PRAGMA table_info(chunks)`)
    .all() as Array<{ name: string }>
  const chunkColNames = new Set(existingChunkCols.map((c) => c.name))

  if (!chunkColNames.has('embedding')) {
    db.exec(`ALTER TABLE chunks ADD COLUMN embedding BLOB`)
  }

  const existingJobCols = db
    .prepare(`PRAGMA table_info(jobs)`)
    .all() as Array<{ name: string }>
  const jobColNames = new Set(existingJobCols.map((c) => c.name))

  if (!jobColNames.has('payload')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN payload TEXT`)
  }
  if (!jobColNames.has('phase')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN phase TEXT`)
  }

  const existingBookCols = db
    .prepare(`PRAGMA table_info(books)`)
    .all() as Array<{ name: string }>
  const bookColNames = new Set(existingBookCols.map((c) => c.name))

  if (!bookColNames.has('chapter_count')) {
    db.exec(`ALTER TABLE books ADD COLUMN chapter_count INTEGER`)
  }

  // Seed known speaker aliases (INSERT OR IGNORE — safe to re-run on every startup).
  const aliasStmt = db.prepare(`INSERT OR IGNORE INTO speaker_aliases (alias, canonical_name) VALUES (?, ?)`)
  db.transaction(() => {
    for (const [alias, canonical] of SEED_ALIASES) {
      aliasStmt.run(alias, canonical)
    }
  })()
}

// Alias → canonical speaker name as stored in sermons.speaker.
// Aliases are lowercased; resolution is case-insensitive.
const SEED_ALIASES: ReadonlyArray<[string, string]> = [
  ['apostle',               'Apostle Emmanuel Iren'],
  ['apostle emmanuel iren', 'Apostle Emmanuel Iren'],
  ['pastor emmanuel iren',  'Apostle Emmanuel Iren'],
  ['pastey',                'Apostle Emmanuel Iren'],
  ['pie',                   'Apostle Emmanuel Iren'],
  ['pastor laju',           'Pastor Laju'],
  ['a-z l',                 'Pastor Laju'],
  ['pl',                    'Pastor Laju'],
]
