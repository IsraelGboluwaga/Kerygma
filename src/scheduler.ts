import cron from 'node-cron'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from './logger.js'
import { errMsg } from './utils.js'
import { enqueue, getQueueDepth } from './queue.js'
import { getSermonByVideoId, getMissingVideoIdsByKind, getConfig, setConfig } from './db/queries.js'
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

  try {
    for await (const req of fetchAllSermons()) {
      if (req.videoId && noAudioIds.has(req.videoId)) {
        skipped++
        continue
      }

      // Skip only fully-ingested sermons. A partial row (ingestion_status
      // 'transcribed' — e.g. a prior chunking failure) is re-enqueued so it
      // resumes from the stored transcript instead of being stranded forever;
      // ingestSermon's resume path skips the re-download + transcription.
      const existing = req.videoId ? getSermonByVideoId(req.videoId) : null
      if (existing && existing.ingestion_status === 'done') {
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

const FREQUENT_UNTIL_KEY = 'scheduler_frequent_until'
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000

function startDailyCron(anthropic: Anthropic): void {
  cron.schedule('0 6 * * *', () => {
    void syncFromApi(anthropic)
  })
  logger.info('Scheduler updated — syncing daily at 06:00')
}

export function startScheduler(anthropic: Anthropic): void {
  const stored = getConfig(FREQUENT_UNTIL_KEY)
  const deadline = stored ? parseInt(stored, 10) : Date.now() + FOUR_DAYS_MS
  if (!stored) setConfig(FREQUENT_UNTIL_KEY, String(deadline))

  // Always sync immediately on startup so a fresh deploy or restart doesn't
  // wait up to 10 hours for the first batch of sermons to be enqueued.
  void syncFromApi(anthropic)

  const remainingMs = deadline - Date.now()

  if (remainingMs <= 0) {
    startDailyCron(anthropic)
    return
  }

  // Frequent phase: every 10 hours until the persisted deadline
  const frequentTask = cron.schedule('0 */10 * * *', () => {
    void syncFromApi(anthropic)
  })
  logger.info(`Scheduler started — syncing every 10 hours for ${Math.ceil(remainingMs / 3_600_000)} more hour(s)`)

  setTimeout(() => {
    frequentTask.stop()
    startDailyCron(anthropic)
  }, remainingMs)
}
