import { useCallback, useEffect, useRef, useState } from 'react'
import { TopBar } from '../components/Layout'

interface Job {
  id: string
  status: string
  title?: string
  message?: string
  error?: string
  createdAt: string
  payload?: string
  downloadUrl?: string
}

type StatusType = 'queued' | 'running' | 'done' | 'failed' | 'error'

function Badge({ status }: { status: string }) {
  const valid = ['queued', 'running', 'done', 'failed']
  const s = valid.includes(status) ? status : 'unknown'
  return <span className={`badge badge-${s}`}>{s}</span>
}

function StatusBox({ text, type }: { text: string; type: StatusType }) {
  return <div className={`status-box status-${type}`}>{text}</div>
}

export function AdminPage() {
  const [secret, setSecret] = useState('')
  const [formEnabled, setFormEnabled] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [status, setStatus] = useState<{ text: string; type: StatusType } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadJobs = useCallback(async (s = secret) => {
    if (!s) { setFormEnabled(false); setJobs([]); return }
    try {
      const res = await fetch('/api/admin/jobs', { headers: { 'X-Admin-Secret': s } })
      if (res.status === 401) { setFormEnabled(false); return }
      if (!res.ok) return
      setFormEnabled(true)
      const data: Job[] = await res.json()
      setJobs(data)
    } catch { /* network error */ }
  }, [secret])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadJobs(secret), 400)
  }, [secret, loadJobs])

  const pollJob = useCallback((id: string, currentSecret: string) => {
    let lastStatus: string | null = null
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/jobs/${id}`, {
          headers: { 'X-Admin-Secret': currentSecret },
        })
        const job: Job = await res.json()
        if (job.status === 'done') {
          clearInterval(iv)
          setStatus({ text: `Done: ${job.message ?? 'Sermon ingested'}`, type: 'done' })
          loadJobs(currentSecret)
        } else if (job.status === 'failed') {
          clearInterval(iv)
          setStatus({ text: `Failed: ${job.message ?? job.error ?? 'Unknown error'}`, type: 'failed' })
          loadJobs(currentSecret)
        } else if (job.status !== lastStatus) {
          lastStatus = job.status
          setStatus({ text: `Status: ${job.status}…`, type: job.status as StatusType })
        }
      } catch {
        clearInterval(iv)
        setStatus({ text: 'Lost connection while polling.', type: 'failed' })
      }
    }, 3000)
  }, [loadJobs])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!secret) { setStatus({ text: 'Enter your admin secret first.', type: 'error' }); return }
    const form = e.currentTarget
    const fd = new FormData(form)
    const tagsRaw = (fd.get('tags') as string).trim()
    const body = {
      downloadUrl: (fd.get('downloadUrl') as string).trim(),
      webpageUrl: (fd.get('webpageUrl') as string).trim() || undefined,
      title: (fd.get('title') as string).trim(),
      series: (fd.get('series') as string).trim() || undefined,
      speaker: (fd.get('speaker') as string).trim(),
      date: fd.get('date') as string,
      tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    }
    setStatus({ text: 'Queued…', type: 'queued' })
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { setStatus({ text: 'Wrong admin secret.', type: 'error' }); return }
      if (!res.ok) { setStatus({ text: `Server error: ${res.status}`, type: 'error' }); return }
      const { jobId } = await res.json()
      setStatus({ text: 'Job queued. Processing…', type: 'running' })
      form.reset()
      pollJob(jobId, secret)
      loadJobs(secret)
    } catch (err) {
      setStatus({ text: `Request failed: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const retryJob = async (payload: string) => {
    if (!secret) return
    try {
      const res = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: payload,
      })
      if (!res.ok) { setStatus({ text: `Retry failed: ${res.status}`, type: 'failed' }); return }
      const { jobId } = await res.json()
      setStatus({ text: 'Retry queued. Processing…', type: 'running' })
      pollJob(jobId, secret)
      loadJobs(secret)
    } catch (err) {
      setStatus({ text: `Retry failed: ${err instanceof Error ? err.message : String(err)}`, type: 'failed' })
    }
  }

  const succeededUrls = new Set(
    jobs.filter(j => j.status === 'done' && j.downloadUrl).map(j => j.downloadUrl!)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TopBar subtitle="Sermon ingestion" logoHref="/" />

      <div className="columns">
        <div className="col col-left">
          <div className="card">
            <div className="field" style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="secret">Admin Secret</label>
              <input
                type="password"
                id="secret"
                placeholder="Enter admin secret"
                autoComplete="current-password"
                value={secret}
                onChange={e => setSecret(e.target.value)}
              />
            </div>

            <h2>New Ingestion</h2>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Download URL <span style={{ color: 'var(--accent)' }}>*</span></label>
                <input type="url" name="downloadUrl" placeholder="https://example.com/sermon.mp3" required disabled={!formEnabled || submitting} />
              </div>
              <div className="field">
                <label>Webpage URL <span style={{ color: 'var(--tx-ghost)' }}>(optional)</span></label>
                <input type="url" name="webpageUrl" placeholder="https://church.org/services/2024-03-10" disabled={!formEnabled || submitting} />
              </div>
              <div className="form-row">
                <div className="field">
                  <label>Title <span style={{ color: 'var(--accent)' }}>*</span></label>
                  <input type="text" name="title" placeholder="Sunday Service" required disabled={!formEnabled || submitting} />
                </div>
                <div className="field">
                  <label>Series <span style={{ color: 'var(--tx-ghost)' }}>(optional)</span></label>
                  <input type="text" name="series" placeholder="Faith Foundations" disabled={!formEnabled || submitting} />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>Speaker <span style={{ color: 'var(--accent)' }}>*</span></label>
                  <input type="text" name="speaker" placeholder="Apostle Emmanuel Iren" required disabled={!formEnabled || submitting} />
                </div>
                <div className="field">
                  <label>Date <span style={{ color: 'var(--accent)' }}>*</span></label>
                  <input type="date" name="date" required disabled={!formEnabled || submitting} />
                </div>
              </div>
              <div className="field">
                <label>Tags <span style={{ color: 'var(--tx-ghost)' }}>(comma-separated, optional)</span></label>
                <input type="text" name="tags" placeholder="faith, prayer, healing" disabled={!formEnabled || submitting} />
              </div>
              <button type="submit" className="btn-primary" disabled={!formEnabled || submitting}>
                Ingest Sermon
              </button>
            </form>
            {status && <StatusBox text={status.text} type={status.type} />}
          </div>
        </div>

        <div className="col col-right">
          <div className="card">
            <h2>
              Recent Jobs{' '}
              <button type="button" className="btn-ghost" style={{ marginLeft: '0.5rem' }} onClick={() => loadJobs()}>
                Refresh
              </button>
            </h2>
            <div className="jobs-table">
              {jobs.length === 0 ? (
                <em style={{ color: 'var(--tx-ghost)' }}>No jobs yet.</em>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Time</th><th>Title</th><th>Status</th><th>Message</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(j => (
                      <tr key={j.id}>
                        <td>{new Date(j.createdAt).toLocaleString()}</td>
                        <td>{j.title ?? '—'}</td>
                        <td><Badge status={j.status} /></td>
                        <td>{j.message ?? j.error ?? ''}</td>
                        <td>
                          {j.status === 'failed' && j.payload && !succeededUrls.has(j.downloadUrl ?? '') && (
                            <button className="btn-outline-accent" onClick={() => retryJob(j.payload!)}>
                              Retry
                            </button>
                          )}
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
    </div>
  )
}
