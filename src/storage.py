import json
import os
import sqlite3
from contextlib import contextmanager

from .config import settings


def get_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_connection():
    """Context manager for database connections.

    Usage:
        with db_connection() as conn:
            conn.execute(...)
    """
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_database() -> None:
    with db_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sermons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                date TEXT NOT NULL,
                url TEXT NOT NULL,
                speaker TEXT,
                duration INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sermon_id INTEGER NOT NULL,
                section_name TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp_start REAL NOT NULL,
                timestamp_end REAL NOT NULL,
                topics TEXT,
                summary TEXT,
                FOREIGN KEY (sermon_id) REFERENCES sermons(id)
            );

            CREATE INDEX IF NOT EXISTS idx_sermon_date ON sermons(date);
            CREATE INDEX IF NOT EXISTS idx_sermon_video_id ON sermons(video_id);
            CREATE INDEX IF NOT EXISTS idx_chunk_sermon_id ON chunks(sermon_id);

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
        """)
        conn.commit()


def save_sermon(sermon_data: dict) -> int:
    with db_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO sermons (video_id, title, date, url, speaker, duration)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                sermon_data["video_id"],
                sermon_data["title"],
                sermon_data["date"],
                sermon_data["url"],
                sermon_data.get("speaker"),
                sermon_data.get("duration"),
            ),
        )
        conn.commit()
        return cursor.lastrowid


def save_chunks(sermon_id: int, chunks: list[dict]) -> None:
    with db_connection() as conn:
        conn.executemany(
            """INSERT INTO chunks
               (sermon_id, section_name, content, timestamp_start, timestamp_end, topics, summary)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    sermon_id,
                    c["section_name"],
                    c["content"],
                    c["timestamp_start"],
                    c["timestamp_end"],
                    json.dumps(c.get("key_topics", [])),
                    c.get("summary", ""),
                )
                for c in chunks
            ],
        )
        conn.commit()


def get_sermon_by_video_id(video_id: str) -> dict | None:
    with db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM sermons WHERE video_id = ?", (video_id,)
        ).fetchone()
        return dict(row) if row else None


def get_sermons_by_date(date: str) -> list[dict]:
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM sermons WHERE date LIKE ?", (f"{date}%",)
        ).fetchall()
        return [dict(r) for r in rows]


def get_chunks_by_sermon_id(sermon_id: int) -> list[dict]:
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM chunks WHERE sermon_id = ? ORDER BY timestamp_start",
            (sermon_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def search_chunks(query: str, limit: int = 10) -> list[dict]:
    with db_connection() as conn:
        rows = conn.execute(
            """SELECT c.*, s.title AS sermon_title, s.date, s.url, s.speaker
               FROM chunks_fts fts
               JOIN chunks c ON c.id = fts.rowid
               JOIN sermons s ON s.id = c.sermon_id
               WHERE chunks_fts MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (query, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def main():
    """CLI entry point for database initialization."""
    init_database()
    print("Database initialized at", settings.db_path)


if __name__ == "__main__":
    main()
