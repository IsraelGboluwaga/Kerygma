import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'
import { errMsg } from './utils.js'
import { upsertJob, getJobRow, listRecentJobRows, type JobRow } from './db/queries.js'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface Job {
  id: string
  title?: string
  downloadUrl?: string
  payload?: string
  status: JobStatus
  message?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
}

type JobFn = () => Promise<unknown>

const jobs = new Map<string, Job>()
const fns = new Map<string, JobFn>() // job id → async fn (in-memory only)
const queue: string[] = []
let running = false

function persist(job: Job): void {
  try {
    upsertJob({
      id: job.id,
      title: job.title,
      download_url: job.downloadUrl,
      payload: job.payload,
      status: job.status,
      message: job.message,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    })
  } catch (err) {
    // DB not ready (e.g. in tests without initDatabase())
    logger.warn(`Failed to persist job ${job.id} to DB: ${errMsg(err)}`)
  }
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title ?? undefined,
    downloadUrl: row.download_url ?? undefined,
    payload: row.payload ?? undefined,
    status: row.status as JobStatus,
    message: row.message ?? undefined,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  }
}

export function enqueue(fn: JobFn, meta?: { title?: string; downloadUrl?: string; payload?: string }): string {
  const id = randomUUID()
  const job: Job = {
    id,
    status: 'queued',
    createdAt: new Date(),
    title: meta?.title,
    downloadUrl: meta?.downloadUrl,
    payload: meta?.payload,
  }
  jobs.set(id, job)
  fns.set(id, fn)
  queue.push(id)
  persist(job)
  void drain()
  return id
}

async function drain(): Promise<void> {
  if (running || queue.length === 0) return
  running = true

  while (queue.length > 0) {
    const id = queue.shift()!
    const job = jobs.get(id)
    const fn = fns.get(id)

    if (!job || !fn) continue

    job.status = 'running'
    job.startedAt = new Date()
    fns.delete(id)
    persist(job)
    logger.info(`Job ${id} started`)

    try {
      const result = await fn()
      // If the pipeline returned a structured failure, surface it as failed
      if (
        result !== null &&
        typeof result === 'object' &&
        'status' in result &&
        ((result as { status: unknown }).status === 'error' ||
          (result as { status: unknown }).status === 'too_long')
      ) {
        const failMsg = (result as { message?: unknown }).message
        job.status = 'failed'
        job.message = typeof failMsg === 'string' ? failMsg : String(failMsg ?? (result as { status: unknown }).status)
        logger.warn(`Job ${id} failed — ${job.message}`)
      } else {
        job.status = 'done'
        const successMsg = (result as { message?: unknown } | null)?.message
        job.message = typeof successMsg === 'string' ? successMsg : undefined
        logger.info(`Job ${id} done`)
      }
    } catch (err) {
      job.status = 'failed'
      job.error = errMsg(err)
      logger.error(`Job ${id} failed: ${job.error}`)
    } finally {
      job.completedAt = new Date()
      persist(job)
    }
  }

  running = false
}

export function getJob(id: string): Job | undefined {
  const memJob = jobs.get(id)
  if (memJob) return memJob

  // Fall back to DB for jobs from previous server runs
  try {
    const row = getJobRow(id)
    return row ? rowToJob(row) : undefined
  } catch (err) {
    logger.warn(`Failed to fetch job ${id} from DB: ${errMsg(err)}`)
    return undefined
  }
}

export function getRecentJobs(limit = 50): Job[] {
  try {
    // Read full history from DB, overlay in-memory state for active jobs
    const rows = listRecentJobRows(limit)
    return rows.map((row) => jobs.get(row.id) ?? rowToJob(row))
  } catch (err) {
    // DB not available (tests)
    logger.warn(`Failed to fetch recent jobs from DB, falling back to in-memory: ${errMsg(err)}`)
    return [...jobs.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }
}

export function getQueueDepth(): number {
  return queue.length
}

/** Resolves once no job is actively running. Used for graceful shutdown. */
export async function waitUntilIdle(): Promise<void> {
  while (running) {
    await new Promise((r) => setTimeout(r, 100))
  }
}
