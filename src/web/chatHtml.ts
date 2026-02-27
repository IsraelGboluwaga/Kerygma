import { config } from '../config.js'

export function chatHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      color: #1a1a1a;
      height: 100dvh;
      display: flex;
      flex-direction: column;
    }

    header {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    header h1 { font-size: 1.1rem; font-weight: 600; }
    .subtitle { font-size: 0.8rem; color: #6b7280; }

    .new-btn {
      background: none;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 0.35rem 0.8rem;
      font-size: 0.82rem;
      cursor: pointer;
      color: #374151;
      font-family: inherit;
      transition: background 0.15s;
    }
    .new-btn:hover { background: #f3f4f6; }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    #empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: #9ca3af;
      text-align: center;
    }
    .empty-icon { font-size: 2.5rem; margin-bottom: 0.25rem; }
    #empty-state p { font-size: 0.9rem; }

    .msg-row {
      display: flex;
      flex-direction: column;
      max-width: min(75%, 680px);
    }
    .msg-row.user      { align-self: flex-end;   align-items: flex-end; }
    .msg-row.assistant { align-self: flex-start; align-items: flex-start; }

    .bubble {
      padding: 0.7rem 1rem;
      border-radius: 14px;
      font-size: 0.93rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .user .bubble {
      background: #4f46e5;
      color: white;
      border-bottom-right-radius: 4px;
    }
    .assistant .bubble {
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      border-bottom-left-radius: 4px;
    }

    .dots-wrap {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 0.8rem 1rem;
      background: white;
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .dot {
      width: 6px; height: 6px;
      background: #9ca3af;
      border-radius: 50%;
      animation: bounce 1.1s ease-in-out infinite;
    }
    .dot:nth-child(2) { animation-delay: 0.18s; }
    .dot:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30%            { transform: translateY(-5px); }
    }

    details.sources {
      margin-top: 0.4rem;
      font-size: 0.78rem;
    }
    details.sources > summary {
      color: #6b7280;
      cursor: pointer;
      list-style: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    details.sources > summary::marker,
    details.sources > summary::-webkit-details-marker { display: none; }
    details.sources > summary::before       { content: '▶'; font-size: 0.6rem; }
    details.sources[open] > summary::before { content: '▼'; font-size: 0.6rem; }
    details.sources ul {
      margin-top: 0.35rem;
      padding-left: 1.1rem;
      color: #6b7280;
      list-style: disc;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    #input-area {
      background: white;
      border-top: 1px solid #e5e7eb;
      padding: 0.9rem 1rem;
      flex-shrink: 0;
    }
    .input-inner {
      max-width: 760px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    #error-msg {
      padding: 0.5rem 0.8rem;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 6px;
      font-size: 0.83rem;
      display: none;
    }
    .input-row {
      display: flex;
      gap: 0.6rem;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      padding: 0.65rem 0.85rem;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 0.93rem;
      font-family: inherit;
      resize: none;
      line-height: 1.5;
      max-height: 140px;
      overflow-y: auto;
      transition: border-color 0.15s;
    }
    #input:focus   { outline: none; border-color: #4f46e5; }
    #input:disabled { background: #f9fafb; color: #9ca3af; }

    #send-btn {
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0.65rem 1.1rem;
      font-size: 0.93rem;
      font-family: inherit;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    #send-btn:hover:not(:disabled) { background: #4338ca; }
    #send-btn:disabled { background: #a5b4fc; cursor: not-allowed; }
  </style>
</head>
<body>

<header>
  <div>
    <h1>${ministry}</h1>
    <div class="subtitle">Ask questions about our sermons</div>
  </div>
  <button class="new-btn" id="new-btn">New conversation</button>
</header>

<div id="messages">
  <div id="empty-state">
    <div class="empty-icon">&#10011;</div>
    <p>Ask a question about the sermons</p>
  </div>
</div>

<div id="input-area">
  <div class="input-inner">
    <div id="error-msg"></div>
    <div class="input-row">
      <textarea id="input" placeholder="Ask about a sermon\u2026" rows="1"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
</div>

<script>
(function () {
  var messages    = []
  var systemPrompt = null
  var busy        = false

  var msgList  = document.getElementById('messages')
  var inputEl  = document.getElementById('input')
  var sendBtn  = document.getElementById('send-btn')
  var errorMsg = document.getElementById('error-msg')
  var newBtn   = document.getElementById('new-btn')

  // ── Auto-grow textarea ──────────────────────────────────────────────────
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'
  })

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  })

  sendBtn.addEventListener('click', send)
  newBtn.addEventListener('click', function () { if (!busy) location.reload() })

  // ── Helpers ─────────────────────────────────────────────────────────────
  function scroll() { msgList.scrollTop = msgList.scrollHeight }

  function clearEmpty() {
    var el = document.getElementById('empty-state')
    if (el) el.remove()
  }

  function setLoading(on) {
    busy = on
    inputEl.disabled = on
    sendBtn.disabled = on
    sendBtn.textContent = on ? '\u2026' : 'Send'
  }

  function showError(text) {
    errorMsg.textContent = text
    errorMsg.style.display = 'block'
  }

  function hideError() { errorMsg.style.display = 'none' }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function addUserBubble(text) {
    clearEmpty()
    var row = document.createElement('div')
    row.className = 'msg-row user'
    var bub = document.createElement('div')
    bub.className = 'bubble'
    bub.textContent = text
    row.appendChild(bub)
    msgList.appendChild(row)
    scroll()
  }

  function addTyping() {
    var row = document.createElement('div')
    row.className = 'msg-row assistant'
    row.innerHTML = '<div class="dots-wrap"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>'
    msgList.appendChild(row)
    scroll()
    return row
  }

  function addAssistantBubble(sources) {
    var row = document.createElement('div')
    row.className = 'msg-row assistant'

    var bub = document.createElement('div')
    bub.className = 'bubble'
    row.appendChild(bub)

    if (sources && sources.length > 0) {
      var det = document.createElement('details')
      det.className = 'sources'
      var items = sources.map(function (s) {
        return '<li>' + esc(s.title) + ' \u2014 ' + esc(s.date) + ' [' + esc(s.timestamp) + ']</li>'
      }).join('')
      det.innerHTML = '<summary>Sources (' + sources.length + ')</summary><ul>' + items + '</ul>'
      row.appendChild(det)
    }

    msgList.appendChild(row)
    scroll()
    return bub
  }

  // ── SSE stream reader ───────────────────────────────────────────────────
  async function readStream(response, typingRow) {
    var reader  = response.body.getReader()
    var dec     = new TextDecoder()
    var buf     = ''
    var bubble  = null
    var text    = ''
    var sources = null

    typingRow.remove()

    try {
      while (true) {
        var chunk = await reader.read()
        if (chunk.done) break

        buf += dec.decode(chunk.value, { stream: true })

        var idx
        while ((idx = buf.indexOf('\\n\\n')) !== -1) {
          var block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)

          var lines = block.split('\\n')
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i]
            if (!line.startsWith('data: ')) continue
            var ev
            try { ev = JSON.parse(line.slice(6)) } catch (e) { continue }

            if (ev.type === 'context') {
              systemPrompt = ev.systemPrompt
              sources = ev.sources || null
            } else if (ev.type === 'delta') {
              if (!bubble) bubble = addAssistantBubble(sources)
              text += ev.text
              bubble.textContent = text
              scroll()
            } else if (ev.type === 'done') {
              messages.push({ role: 'assistant', content: text })
            } else if (ev.type === 'error') {
              throw new Error(ev.message)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────
  async function send() {
    var text = inputEl.value.trim()
    if (!text || busy) return

    hideError()
    inputEl.value = ''
    inputEl.style.height = 'auto'

    addUserBubble(text)
    messages.push({ role: 'user', content: text })

    var typingRow = addTyping()
    setLoading(true)

    var body = { messages: messages.slice() }
    if (systemPrompt) body.systemPrompt = systemPrompt

    try {
      var res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {} })
        throw new Error(errBody.error || 'Server error ' + res.status)
      }

      await readStream(res, typingRow)
    } catch (err) {
      typingRow.remove()
      messages.pop()
      showError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      inputEl.focus()
    }
  }
})()
</script>
</body>
</html>`
}
