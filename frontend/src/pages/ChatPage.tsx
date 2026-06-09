import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { marked } from 'marked'
import { streamChat } from '../api/client'
import type { ChatMessage } from '../api/types'
import ThemeToggle from '../components/ThemeToggle'
import { useNav } from '../contexts/NavContext'
import { useConversations, type Conversation } from '../contexts/ConversationsContext'

function HamburgerIcon() {
  return (
    <svg
      width="20" height="20" viewBox="0 0 20 20"
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2.5" y1="5" x2="17.5" y2="5" />
      <line x1="2.5" y1="10" x2="17.5" y2="10" />
      <line x1="2.5" y1="15" x2="17.5" y2="15" />
    </svg>
  )
}

function conversationTitle(c: Conversation): string {
  const firstUser = c.turns.find((t) => t.role === 'user')
  if (!firstUser) return 'New chat'
  const text = firstUser.content.trim().replace(/\s+/g, ' ')
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
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

function Sources({ sources }: { sources: import('../api/types').ChatSource[] }) {
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
  const { open } = useNav()
  const {
    conversations, activeId, setActiveId,
    updateConv, updateLastTurn, addConversation, closeConversation,
  } = useConversations()

  // Mirror of conversations for stale-free reads inside the async send loop.
  const convosRef = useRef(conversations)
  useEffect(() => { convosRef.current = conversations }, [conversations])

  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Track the active id so the async send loop can focus only when relevant.
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0]

  // Scroll to bottom and re-fit the textarea when the active conversation changes.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [active.turns, activeId])

  useEffect(() => { autoGrow() }, [activeId])

  function autoGrow() {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }

  async function send(convId: string) {
    const conv = convosRef.current.find((c) => c.id === convId)
    if (!conv) return
    const text = conv.draft.trim()
    if (!text || conv.busy) return

    const convo: ChatMessage[] = [
      ...conv.turns.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ]

    updateConv(convId, (c) => ({
      ...c,
      draft: '',
      busy: true,
      error: null,
      turns: [...c.turns, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }],
    }))
    requestAnimationFrame(autoGrow)

    let acc = ''
    try {
      for await (const ev of streamChat(convo)) {
        if (ev.type === 'delta') {
          acc += ev.text
          updateLastTurn(convId, { content: acc, streaming: true })
        } else if (ev.type === 'context') {
          updateLastTurn(convId, { sources: ev.sources })
        } else if (ev.type === 'done') {
          updateLastTurn(convId, { streaming: false })
        } else if (ev.type === 'error') {
          throw new Error(ev.message)
        }
      }
      updateLastTurn(convId, { streaming: false })
      updateConv(convId, (c) => ({ ...c, busy: false }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      updateConv(convId, (c) => {
        // Drop the empty assistant placeholder; keep the user's message visible.
        const last = c.turns[c.turns.length - 1]
        const turns = last?.role === 'assistant' && last.content === '' ? c.turns.slice(0, -1) : c.turns
        return { ...c, busy: false, error: message, turns }
      })
    } finally {
      if (convId === activeIdRef.current) taRef.current?.focus()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(activeId)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-line bg-bg px-4 py-3 sm:px-6">
        <div className="flex-1 text-left sm:text-center">
          <img className="block h-7 w-auto sm:mx-auto" src="/assets/cci_logo.svg" alt="AI Library" />
          <div className="mt-1 text-[0.72rem] uppercase tracking-[0.06em] text-ink-faint">AI Library</div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/transcripts" className="btn-ghost hidden sm:inline-flex">
            Transcripts
          </Link>
          <button className="btn-ghost hidden sm:inline-flex" onClick={addConversation}>
            New
          </button>
          <ThemeToggle />
          <button
            className="flex items-center justify-center rounded-md border border-line-strong p-1.5 text-ink-dim transition-colors hover:border-accent hover:text-ink-bright sm:hidden"
            aria-label="Open navigation menu"
            onClick={open}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      {/* In-page conversation tabs */}
      <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2 py-1.5">
        {conversations.map((c) => {
          const isActive = c.id === activeId
          return (
            <div
              key={c.id}
              className={[
                'group flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.8rem] transition-colors',
                isActive
                  ? 'border-accent bg-accent-selected text-ink-bright'
                  : 'border-line-strong bg-surface text-ink-dim hover:text-ink-bright',
              ].join(' ')}
            >
              <button
                className="flex items-center gap-1.5 whitespace-nowrap"
                onClick={() => setActiveId(c.id)}
              >
                {c.busy && (
                  <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-accent" />
                )}
                {conversationTitle(c)}
              </button>
              {conversations.length > 1 && (
                <button
                  aria-label="Close conversation"
                  className="-mr-0.5 rounded px-0.5 text-ink-faint opacity-60 transition-opacity hover:text-ink-bright hover:opacity-100"
                  onClick={() => closeConversation(c.id)}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        <button
          aria-label="New conversation"
          className="flex-shrink-0 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[0.8rem] text-ink-dim transition-colors hover:text-ink-bright"
          onClick={addConversation}
        >
          +
        </button>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        {active.turns.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-ghost">
            <img className="mb-1 w-[72px] opacity-20" src="/assets/cci_logo.svg" alt="" />
            <p className="text-[0.88rem] tracking-[0.03em] text-ink-faint">
              Ask a question about the sermons
            </p>
          </div>
        ) : (
          active.turns.map((t, i) =>
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

      <div className="flex-shrink-0 border-t border-line bg-bg px-4 py-3.5">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2">
          {active.error && (
            <div className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-[0.83rem] text-err-text">
              {active.error}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={taRef}
              rows={1}
              value={active.draft}
              disabled={active.busy}
              placeholder="Ask about a sermon…"
              onChange={(e) => {
                updateConv(activeId, (c) => ({ ...c, draft: e.target.value }))
                autoGrow()
              }}
              onKeyDown={onKeyDown}
              className="field max-h-[140px] flex-1 resize-none leading-relaxed disabled:text-ink-ghost"
            />
            <button
              className="btn-primary"
              disabled={active.busy || !active.draft.trim()}
              onClick={() => void send(activeId)}
            >
              {active.busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
