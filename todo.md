# Todo

## Automated ingestion + OpenAI Whisper + verbatim transcripts

### 1. Add `transcripts` table
- Add a new `transcripts` table to the schema:
  ```sql
  CREATE TABLE transcripts (
    sermon_id INTEGER PRIMARY KEY REFERENCES sermons(id),
    text      TEXT NOT NULL
  );
  ```
- Remove `transcription TEXT` column usage from `sermons` (keep the column for backward compat, just stop writing to it)
- Add `saveTranscript(sermonId, text)` and `getTranscript(sermonId)` to `queries.ts`

### 2. Switch to OpenAI Whisper API
- Rewrite `src/ingestion/transcriber.ts` to call `POST https://api.openai.com/v1/audio/transcriptions` with `response_format: verbose_json`
- Map the response `segments` array to the existing `TranscriptSegment[]` shape
- Return the full verbatim `text` alongside segments so the pipeline can store it
- Remove `nodejs-whisper` dependency
- Add `OPENAI_API_KEY` to required env vars in `src/config.ts`

### 3. Store verbatim transcripts
- In `src/ingestion/pipeline.ts`, after transcription call `saveTranscript(sermonId, verbatimText)`
- Remove the `transcription = NULL` wipe from `completeSermon()` in `queries.ts` (or leave it — transcripts now live in the new table)

### 4. Automated ingestion from the sermons API
- New module `src/ingestion/sync.ts`:
  - Fetch all pages from `https://sermons-api.essantra.joincci.org/sermons`
  - For each sermon, derive `video_id` and skip if already in DB
  - Enqueue new sermons into the existing job queue
- Wire sync to run on server startup and on a recurring schedule (e.g. every hour)

### 5. Remove admin ingestion UI
- Drop `POST /admin/ingest` and jobs-polling routes from `src/web/router.ts`
- Repurpose `/admin` to a read-only status page (queue depth, recent jobs, last sync time)
- Delete or gut `src/web/adminHtml.ts` accordingly
- Remove `MAX_QUEUE_DEPTH` guard if no longer needed

### 6. Transcript extraction script
- Once the above is done, a script can query:
  ```sql
  SELECT s.title, s.date, s.speaker, t.text
  FROM sermons s
  JOIN transcripts t ON t.sermon_id = s.id
  WHERE LOWER(s.speaker) LIKE '%iren%'
  ```
  and layer FTS on chunks to filter for sermons with significant "faith" content
