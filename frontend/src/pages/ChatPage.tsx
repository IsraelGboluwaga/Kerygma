import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { marked } from 'marked'
import { streamChat } from '../api/client'
import type { ChatMessage, ChatSource } from '../api/types'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  streaming?: boolean
}

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm border border-line bg-surface-raised px-4 py-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-ghost"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  )
}

function Sources({ sources }: { sources: ChatSource[] }) {
  return (
    <details className="group mt-1.5 text-[0.78rem]">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-ink-faint transition-colors hover:text-ink-dim">
        <span className="text-[0.6rem] transition-transform group-open:rotate-90">▶</span>
        Sources ({sources.length})
      </summary>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-ink-faint">
        {sources.map((s, i) => (
          <li key={i}>
            {s.title} — {s.date}
            {s.timestamp ? ` [${s.timestamp}]` : ''}
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [turns])

  function updateLast(partial: Partial<Turn>) {
    setTurns((prev) => {
      const copy = [...prev]
      const i = copy.length - 1
      if (i >= 0) copy[i] = { ...copy[i], ...partial }
      return copy
    })
  }

  function autoGrow() {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return

    setError(null)
    setInput('')
    requestAnimationFrame(autoGrow)

    const convo: ChatMessage[] = [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ]
    setTurns((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true },
    ])
    setBusy(true)

    let acc = ''
    let srcs: ChatSource[] | undefined
    try {
      for await (const ev of streamChat(convo)) {
        if (ev.type === 'delta') {
          acc += ev.text
          updateLast({ content: acc, streaming: true })
        } else if (ev.type === 'context') {
          srcs = ev.sources
          updateLast({ sources: srcs })
        } else if (ev.type === 'done') {
          updateLast({ streaming: false })
        } else if (ev.type === 'error') {
          throw new Error(ev.message)
        }
      }
      updateLast({ streaming: false })
    } catch (err) {
      // Drop the empty assistant placeholder; keep the user's message visible.
      setTurns((prev) => (prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev))
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      taRef.current?.focus()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-line bg-black px-4 py-3 sm:px-6">
        <div className="flex-1 text-center">
          <img className="mx-auto block h-7 w-auto" src="/assets/cci_logo.svg" alt="AI Library" />
          <div className="mt-1 text-[0.72rem] uppercase tracking-[0.06em] text-ink-faint">
            AI Library
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/transcripts" className="btn-ghost hidden sm:inline-block">
            Transcripts
          </Link>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!busy) {
                setTurns([])
                setError(null)
              }
            }}
          >
            New
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-ghost">
            <img className="mb-1 w-[72px] opacity-20" src="/assets/cci_logo.svg" alt="" />
            <p className="text-[0.88rem] tracking-[0.03em] text-ink-faint">
              Ask a question about the sermons
            </p>
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="flex max-w-[min(75%,680px)] flex-col self-end">
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[0.93rem] leading-relaxed text-white">
                  {t.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex max-w-[min(75%,680px)] flex-col items-start self-start">
                {t.streaming && t.content === '' ? (
                  <TypingDots />
                ) : (
                  <div
                    className="prose-chat break-words rounded-2xl rounded-bl-sm border border-line bg-surface-raised px-4 py-2.5 text-[0.93rem] leading-relaxed text-ink"
                    dangerouslySetInnerHTML={{ __html: marked.parse(t.content) as string }}
                  />
                )}
                {t.sources && t.sources.length > 0 && <Sources sources={t.sources} />}
              </div>
            )
          )
        )}
      </div>

      <div className="flex-shrink-0 border-t border-line bg-black px-4 py-3.5">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2">
          {error && (
            <div className="rounded-md border border-accent-muted bg-[#1c0e0e] px-3 py-2 text-[0.83rem] text-[#ef8888]">
              {error}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              disabled={busy}
              placeholder="Ask about a sermon…"
              onChange={(e) => {
                setInput(e.target.value)
                autoGrow()
              }}
              onKeyDown={onKeyDown}
              className="field max-h-[140px] flex-1 resize-none leading-relaxed disabled:text-ink-ghost"
            />
            <button className="btn-primary" disabled={busy || !input.trim()} onClick={() => void send()}>
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
