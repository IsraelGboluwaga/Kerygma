import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { initDb } from './schema.js'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialised — call initDatabase() first')
  }
  return _db
}

export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? config.DB_PATH
  fs.mkdirSync(path.dirname(path.resolve(resolvedPath)), { recursive: true })

  const db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initDb(db)

  // Always update the module singleton so tests calling initDatabase(':memory:')
  // get a fresh db reflected in all query functions
  _db = db

  return db
}
