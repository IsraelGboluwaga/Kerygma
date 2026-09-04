import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBooks, requestBook } from '../api/client'
import type { Book } from '../api/types'
import { useAdminSecret } from '../lib/useAdminSecret'
import { fmtDateTime } from '../lib/format'
import TopBar from '../components/TopBar'
import Badge from '../components/Badge'

// Progress cell: "3 / 8" once the outline is known, "2 / …" while outlining,
// or "—" before generation has produced anything.
function progressLabel(b: Book): string {
  if (b.chapterCount != null) return `${b.chaptersGenerated} / ${b.chapterCount}`
  if (b.status === 'generating') return `${b.chaptersGenerated} / …`
  return b.chaptersGenerated > 0 ? `${b.chaptersGenerated}` : '—'
}

export default function BookGenPage() {
  const [secret, setSecret] = useAdminSecret()
  const [draft, setDraft] = useState(secret)
  const [loaded, setLoaded] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [books, setBooks] = useState<Book[]>([])
  const [topic, setTopic] = useState('')
  const [msg, setMsg] = useState('')
  const [generating, setGenerating] = useState(false)

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    if (!secret) return
    try {
      setBooks(await getBooks(secret))
      setLoaded(true)
      setAuthError(false)
    } catch {
      setAuthError(true)
    }
  }, [secret])

  useEffect(() => {
    if (!secret) return
    void refresh()
    // Poll every 5 s so an in-progress book's chapter count ticks up live.
    timer.current = setInterval(() => void refresh(), 5000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [secret, refresh])

  async function onGenerate() {
    const t = topic.trim()
    if (!t) return
    setGenerating(true)
    setMsg('Starting book draft…')
    try {
      await requestBook(secret, t)
      setMsg(`Generating a book on “${t}” — watch its progress below.`)
      setTopic('')
      setTimeout(() => void refresh(), 1500)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Book generation failed to start')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        subtitle="Generate Book"
        right={
          <Link to="/admin" className="text-[0.8rem] text-ink-faint hover:text-accent">
            ← Admin
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
                placeholder="Enter admin secret to generate and view books"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setSecret(draft.trim())}
              />
            </div>
            <button className="btn-primary" onClick={() => setSecret(draft.trim())}>
              Load
            </button>
          </div>

          <h2 className="mb-2 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">
            New Book
          </h2>
          <p className="mb-4 text-[0.82rem] text-ink-faint">
            Enter a topic and the app drafts a book from the ministry’s own sermons — outlined and
            written chapter by chapter, then downloadable as a PDF. The number of chapters is
            right-sized to the available sermon material.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1.5 block text-[0.82rem] font-medium text-ink-dim">Topic</label>
              <input
                type="text"
                className="field w-full"
                placeholder="e.g. hope"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onGenerate()}
                disabled={!loaded}
              />
            </div>
            <button
              className="btn-primary"
              disabled={!loaded || generating || !topic.trim()}
              onClick={() => void onGenerate()}
            >
              Generate
            </button>
          </div>
          {msg && <p className="mt-3 text-[0.85rem] text-ink-faint">{msg}</p>}
        </div>

        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-[0.85rem] font-semibold uppercase tracking-[0.05em] text-ink-faint">
            Books
            <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => void refresh()}>
              Refresh
            </button>
          </h2>

          <div className="max-h-[460px] overflow-y-auto">
            {authError ? (
              <em className="text-[#ef8888]">Wrong secret or server error.</em>
            ) : !loaded ? (
              <em className="text-ink-ghost">Enter your admin secret above to view books.</em>
            ) : books.length === 0 ? (
              <em className="text-ink-ghost">No books generated yet.</em>
            ) : (
              <table className="w-full border-collapse text-[0.83rem]">
                <thead>
                  <tr>
                    {['Time', 'Title', 'Topic', 'Status', 'Chapters', ''].map((h, i) => (
                      <th
                        key={i}
                        className="sticky top-0 border-b border-line bg-surface px-3 py-2 text-left text-[0.75rem] uppercase tracking-[0.05em] text-ink-ghost"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap border-b border-[#141414] px-3 py-2 text-[#ccc]">
                        {fmtDateTime(b.createdAt)}
                      </td>
                      <td className="border-b border-[#141414] px-3 py-2 text-[#ccc]">{b.title || '—'}</td>
                      <td className="border-b border-[#141414] px-3 py-2 text-ink-faint">{b.topic}</td>
                      <td className="border-b border-[#141414] px-3 py-2">
                        <Badge status={b.status} />
                      </td>
                      <td className="whitespace-nowrap border-b border-[#141414] px-3 py-2 text-ink-faint">
                        {progressLabel(b)}
                      </td>
                      <td className="border-b border-[#141414] px-3 py-2">
                        {b.status === 'done' ? (
                          <a className="text-accent hover:underline" href={b.downloadUrl}>
                            Download PDF
                          </a>
                        ) : (
                          <span className="text-ink-ghost">—</span>
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
  )
}
