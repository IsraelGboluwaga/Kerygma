import { useCallback, useEffect, useRef, useState } from 'react'
import { getDbTable, ApiError } from '../api/client'
import type { DbTablePage } from '../api/types'
import { useAdminSecret } from '../lib/useAdminSecret'
import { useInterval } from '../lib/useInterval'
import TopBar from '../components/TopBar'

const TABLES = ['sermons', 'themes', 'transcriptions', 'chunks', 'jobs', 'missing_sermons']
const LIMIT = 50
const AUTO_REFRESH_INTERVAL_MS = 5000

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export default function DbBrowserPage() {
  const [secret, setSecret] = useAdminSecret()
  const [table, setTable] = useState('sermons')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<DbTablePage | null>(null)
  const [message, setMessage] = useState('Enter your admin secret above, then select a table.')
  const [auto, setAuto] = useState(false)

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!secret) {
      setPage(null)
      setMessage('Enter your admin secret above, then select a table.')
      return
    }
    setMessage('Loading…')
    try {
      const data = await getDbTable(secret, table, LIMIT, offset)
      setPage(data)
      setMessage(data.rows.length === 0 ? 'No rows.' : '')
    } catch (err) {
      setPage(null)
      if (err instanceof ApiError && err.status === 401) {
        setMessage('Unauthorized — check your admin secret.')
      } else {
        setMessage(err instanceof Error ? err.message : 'Server error')
      }
    }
  }, [secret, table, offset])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh toggle (no immediate call — the effect above already loaded).
  useInterval(() => void load(), AUTO_REFRESH_INTERVAL_MS, auto, false)

  function onSecretChange(value: string) {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setSecret(value.trim()), 400)
  }

  const total = page?.total ?? 0
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + LIMIT, total)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        subtitle="DB Browser"
        right={
          <input
            type="password"
            className="field w-[200px] !py-1.5 !text-[0.8rem]"
            placeholder="Admin secret"
            autoComplete="current-password"
            defaultValue={secret}
            onChange={(e) => onSecretChange(e.target.value)}
          />
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
        <div className="flex flex-wrap items-center gap-2.5">
          {TABLES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTable(t)
                setOffset(0)
              }}
              className={[
                'rounded-md border px-3.5 py-1.5 text-[0.8rem] tracking-[0.02em] transition-colors',
                t === table
                  ? 'border-accent bg-accent-selected text-accent'
                  : 'border-line-strong bg-surface text-ink-dim hover:border-line-strong hover:bg-surface-raised hover:text-ink',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
          <div className="mx-0.5 h-[18px] w-px bg-line" />
          <button className="btn-ghost !px-3 !py-1 !text-[0.76rem]" onClick={() => void load()}>
            Refresh
          </button>
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[0.76rem] text-ink-ghost">
            <input
              type="checkbox"
              className="cursor-pointer accent-accent"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            auto 5s
          </label>
          <span className="ml-auto text-[0.76rem] text-ink-ghost">
            {page ? `${total.toLocaleString()} row${total !== 1 ? 's' : ''}` : ''}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
          {page && page.rows.length > 0 ? (
            <table className="w-max min-w-full border-collapse text-[0.8rem]">
              <thead>
                <tr>
                  {page.columns.map((c) => (
                    <th
                      key={c}
                      className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-3.5 py-2 text-left text-[0.72rem] uppercase tracking-[0.05em] text-ink-ghost"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-surface-raised">
                    {page.columns.map((col) => {
                      const val = row[col]
                      if (val === null || val === undefined) {
                        return (
                          <td key={col} className="border-b border-line px-3.5 py-2 text-line">
                            —
                          </td>
                        )
                      }
                      const s = String(val)
                      if (s.startsWith('[blob:')) {
                        return (
                          <td key={col} className="border-b border-line px-3.5 py-2 italic text-ink-faint">
                            {s}
                          </td>
                        )
                      }
                      return (
                        <td
                          key={col}
                          title={s.length > 80 ? s : undefined}
                          className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-3.5 py-2 text-ink"
                        >
                          {truncate(s, 80)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-[0.84rem] text-ink-ghost">{message}</div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <button
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[0.78rem] text-ink-dim transition-colors hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-line"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            ← Prev
          </button>
          <span className="text-[0.76rem] text-ink-ghost">
            {total === 0 ? '' : `${from}–${to} of ${total.toLocaleString()}`}
          </span>
          <button
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[0.78rem] text-ink-dim transition-colors hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-line"
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
