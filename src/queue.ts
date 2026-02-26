import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Job {
  id: string
  status: JobStatus
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  result?: unknown
  error?: string
}

type JobFn = () => Promise<unknown>

const jobs = new Map<string, Job>()
const fns = new Map<string, JobFn>() // job id → async fn (in-memory only)
const queue: string[] = []
let running = false

export function enqueue(fn: JobFn): string {
  const id = randomUUID()
  const job: Job = { id, status: 'pending', createdAt: new Date() }
  jobs.set(id, job)
  fns.set(id, fn)
  queue.push(id)
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
    logger.info(`Job ${id} started`)

    try {
      const result = await fn()
      job.result = result
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
        logger.warn(`Job ${id} failed — ${failMsg ?? (result as { status: unknown }).status}`)
      } else {
        job.status = 'done'
        logger.info(`Job ${id} done`)
      }
    } catch (err) {
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      logger.error(`Job ${id} failed: ${job.error}`)
    } finally {
      job.completedAt = new Date()
    }
  }

  running = false
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function getRecentJobs(limit = 50): Job[] {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}

/** Resolves once no job is actively running. Used for graceful shutdown. */
export async function waitUntilIdle(): Promise<void> {
  while (running) {
    await new Promise((r) => setTimeout(r, 100))
  }
}
