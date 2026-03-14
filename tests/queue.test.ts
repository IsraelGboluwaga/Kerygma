import { describe, it, expect, beforeEach, vi } from 'vitest'

// Reset the module between each test so queue/running state is fresh
beforeEach(() => {
  vi.resetModules()
})

describe('queue', () => {
  it('enqueue returns a UUID-shaped string', async () => {
    const { enqueue } = await import('../src/queue.js')
    const id = enqueue(() => Promise.resolve('done'))
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    await new Promise((r) => setTimeout(r, 20))
  })

  it('getJob returns the job immediately after enqueue', async () => {
    const { enqueue, getJob } = await import('../src/queue.js')
    const id = enqueue(() => new Promise((r) => setTimeout(() => r('x'), 50)))
    const job = getJob(id)
    expect(job).toBeDefined()
    expect(['queued', 'running']).toContain(job!.status)
    await new Promise((r) => setTimeout(r, 80))
  })

  it('job reaches done status after the fn resolves', async () => {
    const { enqueue, getJob } = await import('../src/queue.js')
    const id = enqueue(() => Promise.resolve('done'))

    await new Promise((r) => setTimeout(r, 50))

    const job = getJob(id)
    expect(job!.status).toBe('done')
    expect(job!.completedAt).toBeInstanceOf(Date)
  })

  it('job reaches failed status when fn rejects, without crashing the queue', async () => {
    const { enqueue, getJob } = await import('../src/queue.js')
    const badId = enqueue(() => Promise.reject(new Error('boom')))
    const goodId = enqueue(() => Promise.resolve('after error'))

    await new Promise((r) => setTimeout(r, 80))

    expect(getJob(badId)!.status).toBe('failed')
    expect(getJob(badId)!.error).toBe('boom')
    expect(getJob(goodId)!.status).toBe('done')
  })

  it('job reaches failed status when fn returns a pipeline error result', async () => {
    const { enqueue, getJob } = await import('../src/queue.js')
    const id = enqueue(() => Promise.resolve({ status: 'error', message: 'something broke' }))

    await new Promise((r) => setTimeout(r, 50))

    expect(getJob(id)!.status).toBe('failed')
  })

  it('jobs run sequentially, not concurrently', async () => {
    const { enqueue } = await import('../src/queue.js')
    const order: number[] = []

    enqueue(async () => {
      await new Promise((r) => setTimeout(r, 30))
      order.push(1)
    })
    enqueue(async () => {
      order.push(2)
    })

    await new Promise((r) => setTimeout(r, 150))
    expect(order).toEqual([1, 2])
  })

  it('getRecentJobs returns jobs sorted newest first', async () => {
    const { enqueue, getRecentJobs } = await import('../src/queue.js')
    enqueue(() => Promise.resolve('a'))
    await new Promise((r) => setTimeout(r, 5))
    enqueue(() => Promise.resolve('b'))

    await new Promise((r) => setTimeout(r, 80))

    const jobs = getRecentJobs(10)
    expect(jobs.length).toBeGreaterThanOrEqual(2)
    expect(jobs[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      jobs[1].createdAt.getTime()
    )
  })

  it('getRecentJobs respects the limit', async () => {
    const { enqueue, getRecentJobs } = await import('../src/queue.js')
    for (let i = 0; i < 5; i++) enqueue(() => Promise.resolve(i))
    await new Promise((r) => setTimeout(r, 80))
    expect(getRecentJobs(2)).toHaveLength(2)
  })
})
