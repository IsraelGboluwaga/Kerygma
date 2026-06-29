import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStatusData, ApiError } from '../api/client'
import type { Job } from '../api/types'
import { useAdminSecret } from '../lib/useAdminSecret'
import TopBar from '../components/TopBar'
import Badge from '../components/Badge'

const PHASES = [
  { key: 'downloading', label: 'Download' },
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'chunking', label: 'Chunk' },
  { key: 'embedding', label: 'Embed' },
]

function Stepper({ phase }: { phase?: string }) {
  const idx = PHASES.findIndex((p) => p.key === phase)
  return (
    <div className="flex items-center">
      {PHASES.map((p, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={p.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-[0.8rem]',
                  done
                    ? 'border-[#004020] bg-badge-done-bg text-badge-done-fg'
                    : active
                      ? 'animate-pulse border-badge-running-fg bg-badge-running-bg text-badge-running-fg'
                      : 'border-line-strong bg-surface-sunken text-ink-ghost',
                ].join(' ')}
              >
                {done ? '✓' : i + 1}
              </div>
              <div
                className={`text-[0.72rem] tracking-[0.03em] ${
                  done ? 'text-badge-done-fg' : active ? 'text-badge-running-fg' : 'text-ink-faint'
                }`}
              >
                {p.label}
              </div>
            </div>
            {i < PHASES.length - 1 && (
              <div className={`mb-5 h-0.5 w-10 ${done ? 'bg-[#004020]' : 'bg-[#222]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function LiveStatusPage() {
  const [secret, setSecret] = useAdminSecret()
  const [jobs, setJobs] = useState<Job[]>([])
  const [footer, setFooter] = useState('Auto-refreshing every 2s.')
  const [authError, setAuthError] = useState(false)
  const [hasSecret, setHasSecret] = useState(!!secret)

  const refresh = useCallback(async () => {
    if (!secret) {
      setHasSecret(false)
      return
    }
    setHasSecret(true)
    try {
      const data = await getStatusData(secret)
      setJobs(data.jobs || [])
      setAuthError(false)
      setFooter(`Queue depth: ${data.queueDepth || 0} · updated ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthError(true)
      else setFooter('Connection lost — retrying…')
    }
  }, [secret])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 2000)
    return () => clearInterval(id)
  }, [refresh])

  const running = jobs.find((j) => j.status === 'running')
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => (a.position || 99) - (b.position || 99))
  const recent = jobs.filter((j) => j.status === 'done' || j.status === 'failed').slice(0, 10)

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        subtitle="Ingestion status"
        right={
          <Link to="/admin" className="text-[0.8rem] text-ink-faint hover:text-accent">
            ← Admin
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-[880px] flex-1 p-6">
        <div className="card mb-5">
          <label className="mb-1.5 block text-[0.82rem] font-medium text-ink-dim">Admin Secret</label>
          <input
            type="password"
            className="field w-full"
            autoComplete="current-password"
            placeholder="Enter admin secret to view status"
            value={secret}
            onChange={(e) => setSecret(e.target.value.trim())}
          />
        </div>

        <div className="card mb-5">
          <h2 className="mb-4 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">
            Now Processing
          </h2>
          {!hasSecret ? (
            <span className="italic text-ink-ghost">Enter the admin secret to view status.</span>
          ) : authError ? (
            <span className="text-[#ef8888]">Wrong admin secret.</span>
          ) : !running ? (
            <span className="italic text-ink-ghost">Idle — nothing is processing right now.</span>
          ) : (
            <>
              <div className="mb-5 text-[1.05rem] font-semibold text-[#eee]">
                {running.title || 'Untitled'}
                {running.startedAt && (
                  <span className="text-[0.78rem] text-ink-faint">
                    {' '}
                    · started {new Date(running.startedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <Stepper phase={running.phase} />
            </>
          )}
        </div>

        <div className="card mb-5">
          <h2 className="mb-4 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">Queue</h2>
          {queued.length === 0 ? (
            <span className="italic text-ink-ghost">Queue is empty.</span>
          ) : (
            <table className="w-full border-collapse text-[0.83rem]">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left text-[0.75rem] uppercase tracking-[0.05em] text-ink-ghost">
                    Position
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left text-[0.75rem] uppercase tracking-[0.05em] text-ink-ghost">
                    Title
                  </th>
                </tr>
              </thead>
              <tbody>
                {queued.map((j) => (
                  <tr key={j.id}>
                    <td className="border-b border-[#141414] px-3 py-2 tabular-nums text-badge-queued-fg">
                      {j.position != null ? `#${j.position}` : '—'}
                    </td>
                    <td className="border-b border-[#141414] px-3 py-2 text-[#ccc]">{j.title || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card mb-5">
          <h2 className="mb-4 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">Recent</h2>
          {recent.length === 0 ? (
            <span className="italic text-ink-ghost">No finished jobs yet.</span>
          ) : (
            <table className="w-full border-collapse text-[0.83rem]">
              <thead>
                <tr>
                  {['Time', 'Title', 'Status', 'Message'].map((h) => (
                    <th
                      key={h}
                      className="border-b border-line px-3 py-2 text-left text-[0.75rem] uppercase tracking-[0.05em] text-ink-ghost"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr key={j.id}>
                    <td className="border-b border-[#141414] px-3 py-2 text-[#ccc]">
                      {new Date(j.completedAt || j.createdAt).toLocaleString()}
                    </td>
                    <td className="border-b border-[#141414] px-3 py-2 text-[#ccc]">{j.title || '—'}</td>
                    <td className="border-b border-[#141414] px-3 py-2">
                      <Badge status={j.status} />
                    </td>
                    <td
                      className={`border-b border-[#141414] px-3 py-2 ${
                        j.status === 'failed' ? 'text-[#ef8888]' : 'text-ink-faint'
                      }`}
                    >
                      {j.message || j.error || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[0.78rem] text-ink-faint">{footer}</p>
      </main>
    </div>
  )
}
