import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminJobs, getAdminStatus, syncApi } from '../api/client'
import type { AdminStatus, Job } from '../api/types'
import { useAdminSecret } from '../lib/useAdminSecret'
import { useInterval } from '../lib/useInterval'
import { fmtDateTime, fmtRelative } from '../lib/format'
import TopBar from '../components/TopBar'
import Badge from '../components/Badge'

const REFRESH_INTERVAL_MS = 30_000

export default function AdminPage() {
  const [secret, setSecret] = useAdminSecret()
  const [draft, setDraft] = useState(secret)
  const [loaded, setLoaded] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    if (!secret) return
    try {
      const [st, jb] = await Promise.all([getAdminStatus(secret), getAdminJobs(secret)])
      setStatus(st)
      setJobs(jb)
      setLoaded(true)
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }, [secret])

  useInterval(() => void refresh(), REFRESH_INTERVAL_MS, !!secret)

  async function onSync() {
    setSyncing(true)
    setSyncMsg('Syncing...')
    try {
      await syncApi(secret)
      setSyncMsg('Sync started — jobs will appear below.')
      setTimeout(() => void refresh(), 3000)
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        subtitle="Ingestion Status"
        right={
          <Link to="/admin/live" className="text-[0.8rem] text-ink-faint hover:text-accent">
            Live status →
          </Link>
        }
      />

      <div className="flex w-full flex-1 flex-col gap-6 p-6">
        <div className="card">
          <div className="mb-6 flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-[0.82rem] font-medium text-ink-dim">Admin Secret</label>
              <input
                type="password"
                className="field w-full"
                autoComplete="current-password"
                placeholder="Enter admin secret to view status"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setSecret(draft.trim())}
              />
            </div>
            <button className="btn-primary" onClick={() => setSecret(draft.trim())}>
              Load
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Sermons indexed" value={status ? String(status.sermonCount) : '—'} />
            <Stat
              label="Queue depth"
              value={status ? String(status.queueDepth || 0) : '—'}
              sub={status ? (status.queueDepth > 0 ? 'processing...' : 'idle') : ''}
            />
            <Stat label="Last sync" value={status ? fmtRelative(status.lastSyncAt) : '—'} small />
          </div>
        </div>

        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">
            Recent Jobs
            <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => void refresh()}>
              Refresh
            </button>
          </h2>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={!loaded || syncing} onClick={() => void onSync()}>
              Sync Now
            </button>
            <span className="text-[0.85rem] text-ink-faint">{syncMsg}</span>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {authError ? (
              <em className="text-err-text">Wrong secret or server error.</em>
            ) : !loaded ? (
              <em className="text-ink-ghost">Enter your admin secret above to view jobs.</em>
            ) : jobs.length === 0 ? (
              <em className="text-ink-ghost">No jobs yet.</em>
            ) : (
              <table className="w-full border-collapse text-[0.83rem]">
                <thead>
                  <tr>
                    {['Time', 'Title', 'Status', 'Message'].map((h) => (
                      <th
                        key={h}
                        className="sticky top-0 border-b border-line bg-surface px-3 py-2 text-left text-[0.75rem] uppercase tracking-[0.05em] text-ink-ghost"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-ink">
                        {fmtDateTime(j.createdAt)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-ink">{j.title || '—'}</td>
                      <td className="border-b border-line px-3 py-2">
                        <Badge status={j.status} />
                      </td>
                      <td className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-3 py-2 text-ink-faint">
                        {j.message || j.error || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  small,
}: {
  label: string
  value: string
  sub?: string
  small?: boolean
}) {
  return (
    <div className="rounded-md border border-line bg-surface-sunken px-5 py-4">
      <div className="mb-1.5 text-[0.72rem] uppercase tracking-[0.05em] text-ink-faint">{label}</div>
      <div className={`font-semibold text-ink-bright ${small ? 'pt-1 text-base' : 'text-2xl'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[0.78rem] text-ink-ghost">{sub}</div>}
    </div>
  )
}
