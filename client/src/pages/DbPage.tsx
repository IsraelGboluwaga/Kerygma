import { useCallback, useEffect, useRef, useState } from 'react'
import { TopBar } from '../components/Layout'

type TableName = 'sermons' | 'chunks' | 'jobs'

interface TableData {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
}

const TABLES: TableName[] = ['sermons', 'chunks', 'jobs']
const LIMIT = 50

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function DbPage() {
  const [secret, setSecret] = useState('')
  const [activeTable, setActiveTable] = useState<TableName>('sermons')
  const [data, setData] = useState<TableData | null>(null)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secretDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (s = secret, table = activeTable, off = offset) => {
    if (!s) { setData(null); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/db/${table}?limit=${LIMIT}&offset=${off}`,
        { headers: { 'X-Admin-Secret': s } }
      )
      if (res.status === 401) { setError('Unauthorized — check your admin secret.'); setData(null); return }
      if (!res.ok) { setError(`Server error ${res.status}`); return }
      const d: TableData = await res.json()
      setData(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [secret, activeTable, offset])

  // Debounce secret input
  useEffect(() => {
    if (secretDebounce.current) clearTimeout(secretDebounce.current)
    secretDebounce.current = setTimeout(() => load(secret, activeTable, offset), 400)
  }, [secret]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when table or offset changes
  useEffect(() => { load(secret, activeTable, offset) }, [activeTable, offset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh
  useEffect(() => {
    if (autoRef.current) clearInterval(autoRef.current)
    if (autoRefresh) autoRef.current = setInterval(() => load(), 5000)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [autoRefresh, load])

  const switchTable = (t: TableName) => {
    setActiveTable(t)
    setOffset(0)
  }

  const total = data?.total ?? 0
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + LIMIT, total)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TopBar
        subtitle="DB Browser"
        logoHref="/"
        right={
          <input
            className="secret-input"
            type="password"
            placeholder="Admin secret"
            autoComplete="current-password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
          />
        }
      />

      <div className="db-main">
        <div className="controls">
          {TABLES.map(t => (
            <button
              key={t}
              className={`table-btn${activeTable === t ? ' active' : ''}`}
              onClick={() => switchTable(t)}
            >
              {t}
            </button>
          ))}
          <div className="ctrl-divider" />
          <button className="icon-btn" onClick={() => load()}>Refresh</button>
          <label className="auto-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            auto 5s
          </label>
          {total > 0 && (
            <span className="row-count">{total.toLocaleString()} row{total !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="table-wrap">
          {!secret && (
            <div className="table-empty">Enter your admin secret above, then select a table.</div>
          )}
          {secret && loading && <div className="table-empty">Loading…</div>}
          {secret && !loading && error && (
            <div className="table-empty" style={{ color: 'var(--f-fg)' }}>{error}</div>
          )}
          {secret && !loading && !error && data && data.rows.length === 0 && (
            <div className="table-empty">No rows.</div>
          )}
          {secret && !loading && !error && data && data.rows.length > 0 && (
            <table>
              <thead>
                <tr>{data.columns.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    {data.columns.map(col => {
                      const val = row[col]
                      if (val === null || val === undefined) {
                        return <td key={col} className="cell-null">—</td>
                      }
                      const s = String(val)
                      if (s.startsWith('[blob:')) {
                        return <td key={col} className="cell-blob">{s}</td>
                      }
                      const display = truncate(s, 80)
                      return (
                        <td key={col} title={s.length > 80 ? s : undefined}>{display}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pagination">
          <button
            className="page-btn"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            ← Prev
          </button>
          <span className="page-info">
            {total > 0 ? `${from}–${to} of ${total.toLocaleString()}` : ''}
          </span>
          <button
            className="page-btn"
            disabled={to >= total}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
