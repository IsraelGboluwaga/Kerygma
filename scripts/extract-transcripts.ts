/**
 * Extract verbatim transcripts for sermons matching a speaker filter and
 * optionally a keyword (e.g. "faith") found in the FTS chunks.
 *
 * Usage:
 *   yarn tsx scripts/extract-transcripts.ts [speaker-filter] [keyword]
 *
 * Examples:
 *   yarn tsx scripts/extract-transcripts.ts iren faith   # sermons by Iren with "faith" chunks
 *   yarn tsx scripts/extract-transcripts.ts iren          # all Iren transcripts
 *   yarn tsx scripts/extract-transcripts.ts               # all transcripts
 *
 * Output: JSON array written to stdout, one object per sermon:
 *   { id, title, date, speaker, transcript }
 */

import 'dotenv/config'
import Database from 'better-sqlite3'
import { config } from '../src/config.js'

const speakerFilter = process.argv[2] ?? ''
const keyword = process.argv[3] ?? ''

const db = new Database(config.DB_PATH, { readonly: true })

interface Row {
  id: number
  title: string
  date: string
  speaker: string | null
  transcript: string
}

let rows: Row[]

if (keyword) {
  rows = db
    .prepare(
      `SELECT DISTINCT s.id, s.title, s.date, s.speaker, t.transcript
       FROM sermons s
       JOIN transcriptions t ON t.sermon_id = s.id
       WHERE s.ingestion_status = 'done'
         AND (? = '' OR LOWER(s.speaker) LIKE LOWER(?))
         AND s.id IN (
           SELECT c.sermon_id
           FROM chunks_fts fts
           JOIN chunks c ON c.id = fts.rowid
           WHERE chunks_fts MATCH ?
         )
       ORDER BY s.date DESC`
    )
    .all(speakerFilter, `%${speakerFilter}%`, `"${keyword}"`) as Row[]
} else {
  rows = db
    .prepare(
      `SELECT s.id, s.title, s.date, s.speaker, t.transcript
       FROM sermons s
       JOIN transcriptions t ON t.sermon_id = s.id
       WHERE s.ingestion_status = 'done'
         AND (? = '' OR LOWER(s.speaker) LIKE LOWER(?))
       ORDER BY s.date DESC`
    )
    .all(speakerFilter, `%${speakerFilter}%`) as Row[]
}

process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
process.stderr.write(`Extracted ${rows.length} transcript(s)\n`)
