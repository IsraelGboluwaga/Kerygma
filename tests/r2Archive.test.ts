import { Readable, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const backup = vi.fn(async (destination: string) => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, 'sqlite backup')
  })

  const schedule = vi.fn()
  const request = vi.fn()
  const info = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()

  return { backup, schedule, request, info, warn, error }
})

vi.mock('../src/db/connection.js', () => ({
  getDb: vi.fn(() => ({ backup: mocks.backup })),
}))

vi.mock('../src/logger.js', () => ({
  logger: {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  },
}))

vi.mock('node-cron', () => ({
  default: { schedule: mocks.schedule },
  schedule: mocks.schedule,
}))

vi.mock('node:https', () => ({
  default: { request: mocks.request },
  request: mocks.request,
}))

function mockSuccessfulR2Upload(): void {
  mocks.request.mockImplementation((_options, callback) => {
    const res = Readable.from([])
    Object.assign(res, { statusCode: 200, setEncoding: vi.fn() })
    queueMicrotask(() => callback(res))

    return new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    })
  })
}

async function importArchiveModule(): Promise<typeof import('../src/backup/r2Archive.js')> {
  vi.resetModules()
  return import('../src/backup/r2Archive.js')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-08T22:15:00Z'))
  vi.clearAllMocks()
  mockSuccessfulR2Upload()

  process.env.R2_ACCOUNT_ID = 'account-id'
  process.env.R2_ACCESS_KEY_ID = 'access-key'
  process.env.R2_SECRET_ACCESS_KEY = 'secret-key'
  process.env.R2_BUCKET = 'kerygma'
  process.env.DB_PATH = '/tmp/kerygma-test/sermons.db'
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.R2_ACCOUNT_ID
  delete process.env.R2_ACCESS_KEY_ID
  delete process.env.R2_SECRET_ACCESS_KEY
  delete process.env.R2_BUCKET
})

describe('archiveDatabaseToR2', () => {
  it('creates a dated SQLite archive and uploads it to R2', async () => {
    const { archiveDatabaseToR2 } = await importArchiveModule()

    await archiveDatabaseToR2()

    const expectedArchiveKey = 'archives/sermons-2026-06-08T22-15-00Z.db'
    expect(mocks.backup).toHaveBeenCalledWith('/tmp/kerygma-test/.sermons-archive-2026-06-08T22-15-00Z.db')
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        hostname: 'account-id.r2.cloudflarestorage.com',
        path: `/kerygma/${expectedArchiveKey}`,
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Credential=access-key/20260608/auto/s3/aws4_request'),
          'Content-Type': 'application/vnd.sqlite3',
          'x-amz-date': '20260608T221500Z',
        }),
      }),
      expect.any(Function)
    )
    expect(mocks.info).toHaveBeenCalledWith(`R2 archive complete: ${expectedArchiveKey}`)
  })

  it('does nothing when R2 env vars are not configured', async () => {
    delete process.env.R2_BUCKET
    const { archiveDatabaseToR2 } = await importArchiveModule()

    await archiveDatabaseToR2()

    expect(mocks.backup).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('startR2ArchiveScheduler', () => {
  it('runs an immediate archive and schedules the daily UTC archive', async () => {
    const { startR2ArchiveScheduler } = await importArchiveModule()

    startR2ArchiveScheduler()
    await vi.runAllTimersAsync()

    expect(mocks.backup).toHaveBeenCalledTimes(1)
    expect(mocks.schedule).toHaveBeenCalledWith(
      '15 3 * * *',
      expect.any(Function),
      { timezone: 'Etc/UTC' }
    )
  })
})
