import type Database from 'better-sqlite3'

export function initDb(db: Database.Database): void {
  db.exec(`
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
      series           TEXT,
      ingestion_status TEXT NOT NULL DEFAULT 'done',
      transcription    TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      embedding       BLOB
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      download_url TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      message      TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sermon_date       ON sermons(date);
    CREATE INDEX IF NOT EXISTS idx_sermon_video_id   ON sermons(video_id);
    CREATE INDEX IF NOT EXISTS idx_chunk_sermon_id   ON chunks(sermon_id);
    CREATE INDEX IF NOT EXISTS idx_job_created       ON jobs(created_at DESC);

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
  if (!sermonColNames.has('series')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN series TEXT`)
  }
  if (!sermonColNames.has('ingestion_status')) {
    // Existing rows are fully ingested, so default them to 'done'
    db.exec(`ALTER TABLE sermons ADD COLUMN ingestion_status TEXT NOT NULL DEFAULT 'done'`)
  }
  if (!sermonColNames.has('transcription')) {
    db.exec(`ALTER TABLE sermons ADD COLUMN transcription TEXT`)
  }

  const existingChunkCols = db
    .prepare(`PRAGMA table_info(chunks)`)
    .all() as Array<{ name: string }>
  const chunkColNames = new Set(existingChunkCols.map((c) => c.name))

  if (!chunkColNames.has('embedding')) {
    db.exec(`ALTER TABLE chunks ADD COLUMN embedding BLOB`)
  }
}
