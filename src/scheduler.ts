import cron from 'node-cron'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from './logger.js'
import { errMsg } from './utils.js'
import { enqueue, getQueueDepth } from './queue.js'
import { getDoneVideoIds, getMissingVideoIdsByKind, setConfig } from './db/queries.js'
import { fetchAllSermons } from './ingestion/api-source.js'
import { ingestSermon } from './ingestion/pipeline.js'

const MAX_SYNC_QUEUE_DEPTH = 500

export async function syncFromApi(anthropic: Anthropic): Promise<void> {
  logger.info('API sync: fetching sermon list...')
  let enqueued = 0
  let skipped = 0

  // Sermons already recorded as having no audio will fail the same way every
  // run, so skip them rather than re-enqueuing a doomed job each sync.
  const noAudioIds = getMissingVideoIdsByKind('no_audio')

  // Set of fully-ingested video_ids, loaded once so the per-sermon check below
  // is an in-memory lookup rather than a DB query per item in the roster.
  const doneIds = getDoneVideoIds()

  try {
    for await (const req of fetchAllSermons()) {
      if (req.videoId && noAudioIds.has(req.videoId)) {
        skipped++
        continue
      }

      // Skip only fully-ingested sermons. A partial row (ingestion_status
      // 'transcribed' — e.g. a prior chunking failure) is absent from doneIds,
      // so it's re-enqueued and resumes from the stored transcript instead of
      // being stranded forever; ingestSermon's resume path skips the
      // re-download + transcription.
      if (req.videoId && doneIds.has(req.videoId)) {
        skipped++
        continue
      }

      if (getQueueDepth() >= MAX_SYNC_QUEUE_DEPTH) {
        logger.warn('API sync: queue full — will resume on next scheduled run')
        break
      }

      enqueue(() => ingestSermon(req, anthropic), {
        title: req.title,
        downloadUrl: req.downloadUrl,
        payload: JSON.stringify(req),
      })
      enqueued++
    }
  } catch (err) {
    logger.error(`API sync error: ${errMsg(err)}`)
    return
  }

  setConfig('last_sync_at', new Date().toISOString())
  logger.info(`API sync complete: ${enqueued} enqueued, ${skipped} already ingested`)
}

export function startScheduler(anthropic: Anthropic): void {
  // Always sync immediately on startup so a fresh deploy or restart doesn't
  // wait until the next 06:00 for the first batch of sermons to be enqueued.
  void syncFromApi(anthropic)

  cron.schedule('0 6 * * *', () => {
    void syncFromApi(anthropic)
  })
  logger.info('Scheduler started — syncing daily at 06:00')
}
