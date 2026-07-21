import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listThemes, searchTranscripts } from '../api/client'
import type { ThemeOption, TranscriptRow } from '../api/types'
import TopBar from '../components/TopBar'

const MONTHS = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
]

export default function TranscriptsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Form fields initialised from URL so back-navigation restores them.
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [month, setMonth] = useState(() => searchParams.get('month') ?? '')
  const [year, setYear] = useState(() => searchParams.get('year') ?? '')
  const [theme, setTheme] = useState(() => searchParams.get('theme') ?? '')
  const [speaker, setSpeaker] = useState(() => searchParams.get('speaker') ?? '')

  // Auto-open filters panel if any filter param is already in the URL.
  const [filtersOpen, setFiltersOpen] = useState(() =>
    !!(searchParams.get('month') || searchParams.get('year') || searchParams.get('theme') || searchParams.get('speaker'))
  )

  const [themes, setThemes] = useState<ThemeOption[]>([])
  const [status, setStatus] = useState('')
  const [statusError, setStatusError] = useState(false)
  const [rows, setRows] = useState<TranscriptRow[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    listThemes()
      .then(setThemes)
      .catch(() => setThemes([]))
  }, [])

  // Re-run the search on mount when the URL already has params (back-navigation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (searchParams.toString()) void doSearch() }, [])

  function buildParams(): string {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (year.trim()) p.set('year', year.trim())
    if (month) p.set('month', month)
    if (theme) p.set('theme', theme)
    if (speaker.trim()) p.set('speaker', speaker.trim())
    return p.toString()
  }

  async function doSearch() {
    const params = buildParams()
    if (!params) {
      setStatusError(false)
      setStatus('Enter a search or pick a filter.')
      return
    }
    // Persist current search to URL so back-navigation can restore it.
    setSearchParams(new URLSearchParams(params), { replace: true })
    setBusy(true)
    setStatusError(false)
    setStatus('Searching…')
    setRows([])
    try {
      const data = await searchTranscripts(params)
      setSearched(true)
      setRows(data.sermons)
      setStatus(
        data.interpreted ||
          `${data.sermons.length} ${data.sermons.length === 1 ? 'transcript' : 'transcripts'}`
      )
    } catch (err) {
      setStatusError(true)
      setStatus(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        subtitle="Transcripts"
        right={
          <Link to="/" className="btn-ghost">
            Chat ›
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-[980px] flex-1 px-4 pb-12 pt-6">
        <div className="card !p-4">
          <div className="flex gap-2.5">
            <input
              className="field flex-1 !px-3.5 !py-2.5"
              type="text"
              autoFocus
              value={q}
              placeholder="e.g. sermons in February 2023, or all sermons on faith"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
            />
            <button className="btn-primary flex-shrink-0" disabled={busy} onClick={() => void doSearch()}>
              Search
            </button>
          </div>

          <button
            type="button"
            className="mt-3 text-[0.8rem] text-ink-dim transition-colors hover:text-ink"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filters {filtersOpen ? '▴' : '▾'}
          </button>

          {filtersOpen && (
            <div className="mt-3 flex flex-wrap gap-2.5">
              <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.04em] text-ink-dim">
                Month
                <select className="field min-w-[130px]" value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">Any</option>
                  {MONTHS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.04em] text-ink-dim">
                Year
                <input
                  className="field min-w-[130px]"
                  type="number"
                  inputMode="numeric"
                  placeholder="2023"
                  min={1990}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.04em] text-ink-dim">
                Theme
                <select className="field min-w-[130px]" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="">Any</option>
                  {themes.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.04em] text-ink-dim">
                Speaker
                <input
                  className="field min-w-[130px]"
                  type="text"
                  placeholder="name"
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        <div className={`my-3 min-h-[1.2em] text-[0.82rem] ${statusError ? 'text-err-text' : 'text-ink-dim'}`}>
          {status}
        </div>

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.9rem]">
              <thead className="hidden sm:table-header-group">
                <tr>
                  {['Title', 'Date', 'Theme', 'Transcript'].map((h) => (
                    <th
                      key={h}
                      className="border-b border-line-strong px-2.5 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-[0.05em] text-ink-dim"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.videoId}
                    className="block border border-line sm:table-row sm:border-0 mb-3 sm:mb-0 rounded-xl sm:rounded-none p-1 sm:p-0"
                  >
                    <td className="block sm:table-cell px-3 py-2 sm:border-b sm:border-line align-top">
                      <div>
                        <Link to={r.viewUrl} className="font-semibold text-accent hover:opacity-80 hover:underline">
                          {r.title}
                        </Link>
                      </div>
                      {r.excerpt && <div className="mt-1 max-w-[42ch] text-[0.82rem] text-ink-dim">{r.excerpt}</div>}
                    </td>
                    <td className="block sm:table-cell px-3 py-2 sm:border-b sm:border-line align-top whitespace-nowrap text-ink">
                      <span className="mb-0.5 block text-[0.65rem] uppercase tracking-[0.05em] text-ink-faint sm:hidden">
                        Date
                      </span>
                      {r.dateFormatted}
                    </td>
                    <td className="block sm:table-cell px-3 py-2 sm:border-b sm:border-line align-top">
                      <span className="mb-0.5 block text-[0.65rem] uppercase tracking-[0.05em] text-ink-faint sm:hidden">
                        Theme
                      </span>
                      {r.theme ? (
                        <span className="inline-block rounded-full border border-accent/30 bg-accent-selected px-2.5 py-0.5 text-[0.75rem] text-accent">
                          {r.theme}
                        </span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="block sm:table-cell px-3 py-2 sm:border-b sm:border-line align-top">
                      <span className="mb-0.5 block text-[0.65rem] uppercase tracking-[0.05em] text-ink-faint sm:hidden">
                        Transcript
                      </span>
                      {r.hasTranscript ? (
                        <a
                          className="inline-block whitespace-nowrap rounded-md border border-accent/30 px-2.5 py-1.5 text-[0.85rem] text-accent transition-colors hover:bg-accent-selected"
                          href={r.downloadUrl}
                        >
                          Download PDF
                        </a>
                      ) : (
                        <span className="text-[0.8rem] text-ink-faint">unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          searched &&
          !busy && <p className="mt-4 text-[0.9rem] text-ink-faint">No matching transcripts found.</p>
        )}
      </main>
    </div>
  )
}
