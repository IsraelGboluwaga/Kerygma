import cron from 'node-cron'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from './logger.js'
import { errMsg } from './utils.js'
import { enqueue, getQueueDepth } from './queue.js'
import { getSermonByVideoId } from './db/queries.js'
import { fetchAllSermons } from './ingestion/api-source.js'
import { ingestSermon } from './ingestion/pipeline.js'

const MAX_SYNC_QUEUE_DEPTH = 500

export async function syncFromApi(anthropic: Anthropic): Promise<void> {
  logger.info('API sync: fetching sermon list...')
  let enqueued = 0
  let skipped = 0

  try {
    for await (const req of fetchAllSermons()) {
      if (req.videoId && getSermonByVideoId(req.videoId)) {
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

  logger.info(`API sync complete: ${enqueued} enqueued, ${skipped} already ingested`)
}

export function startScheduler(anthropic: Anthropic): void {
  // Monday (1) and Thursday (4) at 06:00
  cron.schedule('0 6 * * 1,4', () => {
    void syncFromApi(anthropic)
  })
  logger.info('Scheduler started — syncing Mon + Thu at 06:00')
}
