import { useRef, useState, useCallback, useEffect } from 'react'
import { marked } from 'marked'
import { ChatHeader } from '../components/Layout'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Source {
  title: string
  date: string
  timestamp: string
}

interface AssistantMessage extends Message {
  role: 'assistant'
  sources?: Source[]
}

type ChatMessage = Message | AssistantMessage

function esc(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function TypingDots() {
  return (
    <div className="msg-row assistant">
      <div className="dots-wrap">
        <div className="dot" />
        <div className="dot" />
        <div className="dot" />
      </div>
    </div>
  )
}

function AssistantBubble({ content, sources }: { content: string; sources?: Source[] }) {
  return (
    <div className="msg-row assistant">
      <div
        className="bubble"
        dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
      />
      {sources && sources.length > 0 && (
        <details className="sources">
          <summary>Sources ({sources.length})</summary>
          <ul>
            {sources.map((s, i) => (
              <li key={i}>{s.title} — {s.date} [{s.timestamp}]</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [streamingSources, setStreamingSources] = useState<Source[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scroll = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [])

  useEffect(() => { scroll() }, [messages, streamingContent, scroll])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return

    setError(null)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const userMsg: Message = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setBusy(true)
    setStreamingContent('')
    setStreamingSources(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`)
      }

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let text = ''
      let sources: Source[] | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })

        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)

          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue
            let ev: { type: string; sources?: Source[]; text?: string; message?: string }
            try { ev = JSON.parse(line.slice(6)) } catch { continue }

            if (ev.type === 'context') {
              sources = ev.sources ?? null
              setStreamingSources(sources)
            } else if (ev.type === 'delta') {
              text += ev.text ?? ''
              setStreamingContent(text)
            } else if (ev.type === 'done') {
              setMessages(prev => [
                ...prev,
                { role: 'assistant', content: text, sources: sources ?? undefined } as AssistantMessage,
              ])
              setStreamingContent(null)
              setStreamingSources(null)
            } else if (ev.type === 'error') {
              throw new Error(ev.message)
            }
          }
        }
      }
      reader.releaseLock()
    } catch (err) {
      setMessages(prev => prev.slice(0, -1))
      setStreamingContent(null)
      setStreamingSources(null)
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      textareaRef.current?.focus()
    }
  }, [input, busy, messages])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <ChatHeader onNew={() => {}} busy={busy} />

      <div id="messages" ref={messagesRef}>
        {messages.length === 0 && !streamingContent && (
          <div className="empty-state">
            <img className="empty-icon" src="/assets/cci_logo.svg" alt="" />
            <p>Ask a question about the sermons</p>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="msg-row user">
              <div className="bubble">{msg.content}</div>
            </div>
          ) : (
            <AssistantBubble
              key={i}
              content={msg.content}
              sources={(msg as AssistantMessage).sources}
            />
          )
        )}

        {busy && streamingContent === '' && <TypingDots />}

        {streamingContent !== null && streamingContent !== '' && (
          <AssistantBubble content={streamingContent} sources={streamingSources ?? undefined} />
        )}
      </div>

      <div className="input-area">
        <div className="input-inner">
          {error && <div className="error-msg">{error}</div>}
          <div className="input-row">
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="Ask about a sermon…"
              rows={1}
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              disabled={busy}
            />
            <button className="send-btn" onClick={send} disabled={busy}>
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
