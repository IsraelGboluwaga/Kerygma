import { config } from '../config.js'

export function chatHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry}</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #000;
      --surface:  #0d0d0d;
      --input-bg: #0a0a0a;
      --raised:   #111;
      --line:     #1f1f1f;
      --line-2:   #2a2a2a;
      --tx:       #fff;
      --tx-2:     #e5e5e5;
      --tx-muted: #aaa;
      --tx-sub:   #555;
      --tx-ghost: #444;
      --tx-faint: #333;
      --ph:       #444;
      --scrub:    #222;
      --accent:   #df4e4e;
      --accent-h: #c93c3c;
      --dis-bg:   #5a2222;
      --dis-fg:   #8a5555;
      --err-bg:   #1c0e0e;
      --err-fg:   #ef8888;
      --err-bd:   #5a2222;
    }
    [data-theme="light"] {
      --bg:       #fff;
      --surface:  #f5f5f5;
      --input-bg: #fafafa;
      --raised:   #ececec;
      --line:     #e0e0e0;
      --line-2:   #d0d0d0;
      --tx:       #111;
      --tx-2:     #222;
      --tx-muted: #555;
      --tx-sub:   #888;
      --tx-ghost: #999;
      --tx-faint: #aaa;
      --ph:       #bbb;
      --scrub:    #ccc;
      --accent:   #df4e4e;
      --accent-h: #c93c3c;
      --dis-bg:   #fadadc;
      --dis-fg:   #b06060;
      --err-bg:   #fff0f0;
      --err-fg:   #c02020;
      --err-bd:   #f0a0a0;
    }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--tx);
      height: 100dvh;
      display: flex;
      flex-direction: column;
    }

    header {
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-logo { height: 28px; width: auto; display: block; margin: 0 auto; }
    .subtitle { font-size: 0.72rem; color: var(--tx-sub); margin-top: 0.25rem; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; }

    .header-right { display: flex; gap: 0.5rem; align-items: center; }

    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--line-2);
      border-radius: 6px;
      padding: 0.35rem 0.7rem;
      font-size: 0.78rem;
      cursor: pointer;
      color: var(--tx-sub);
      font-family: inherit;
      letter-spacing: 0.03em;
      transition: border-color 0.15s, color 0.15s;
    }
    .theme-toggle-btn:hover { border-color: var(--accent); color: var(--tx); }

    .new-btn {
      background: none;
      border: 1px solid var(--tx-faint);
      border-radius: 6px;
      padding: 0.35rem 0.8rem;
      font-size: 0.82rem;
      cursor: pointer;
      color: var(--tx-muted);
      font-family: inherit;
      letter-spacing: 0.03em;
      transition: border-color 0.15s, color 0.15s;
    }
    .new-btn:hover { border-color: var(--accent); color: var(--tx); }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: var(--scrub); border-radius: 2px; }

    #empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      color: var(--tx-ghost);
      text-align: center;
    }
    .empty-icon {
      width: 72px;
      height: auto;
      opacity: 0.2;
      margin-bottom: 0.25rem;
    }
    #empty-state p { font-size: 0.88rem; letter-spacing: 0.03em; color: var(--tx-sub); }

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
      word-break: break-word;
    }
    .user .bubble {
      background: var(--accent);
      color: #fff;
      border-bottom-right-radius: 4px;
      white-space: pre-wrap;
    }
    .assistant .bubble {
      background: var(--raised);
      color: var(--tx-2);
      border: 1px solid var(--line);
      border-bottom-left-radius: 4px;
    }
    .assistant .bubble p { margin-bottom: 0.6rem; }
    .assistant .bubble p:last-child { margin-bottom: 0; }
    .assistant .bubble ul,
    .assistant .bubble ol { padding-left: 1.4rem; margin-bottom: 0.6rem; }
    .assistant .bubble li { margin-bottom: 0.2rem; }
    .assistant .bubble strong { font-weight: 600; color: var(--tx); }
    .assistant .bubble h1,
    .assistant .bubble h2,
    .assistant .bubble h3 { font-weight: 600; color: var(--tx); margin: 0.6rem 0 0.3rem; }

    .dots-wrap {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 0.8rem 1rem;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: 14px;
      border-bottom-left-radius: 4px;
    }
    .dot {
      width: 6px; height: 6px;
      background: var(--tx-ghost);
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
      color: var(--tx-sub);
      cursor: pointer;
      list-style: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      transition: color 0.15s;
    }
    details.sources > summary:hover { color: var(--tx-muted); }
    details.sources > summary::marker,
    details.sources > summary::-webkit-details-marker { display: none; }
    details.sources > summary::before       { content: '▶'; font-size: 0.6rem; }
    details.sources[open] > summary::before { content: '▼'; font-size: 0.6rem; }
    details.sources ul {
      margin-top: 0.35rem;
      padding-left: 1.1rem;
      color: var(--tx-sub);
      list-style: disc;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    #input-area {
      background: var(--bg);
      border-top: 1px solid var(--line);
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
      background: var(--err-bg);
      color: var(--err-fg);
      border: 1px solid var(--err-bd);
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
      border: 1px solid var(--line-2);
      border-radius: 8px;
      background: var(--surface);
      color: var(--tx);
      font-size: 0.93rem;
      font-family: inherit;
      resize: none;
      line-height: 1.5;
      max-height: 140px;
      overflow-y: auto;
      transition: border-color 0.15s;
    }
    #input::placeholder { color: var(--ph); }
    #input:focus   { outline: none; border-color: var(--accent); }
    #input:disabled { background: var(--input-bg); color: var(--tx-faint); }

    #send-btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.65rem 1.1rem;
      font-size: 0.93rem;
      font-family: inherit;
      cursor: pointer;
      flex-shrink: 0;
      letter-spacing: 0.03em;
      transition: background 0.15s;
    }
    #send-btn:hover:not(:disabled) { background: var(--accent-h); }
    #send-btn:disabled { background: var(--dis-bg); color: var(--dis-fg); cursor: not-allowed; }
  </style>
</head>
<body>

<header>
  <div>
    <img class="header-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
    <div class="subtitle">AI Library</div>
  </div>
  <div class="header-right">
    <button class="theme-toggle-btn" id="theme-toggle">Light</button>
    <button class="new-btn" id="new-btn">New conversation</button>
  </div>
</header>

<div id="messages">
  <div id="empty-state">
    <img class="empty-icon" src="/assets/cci_logo.svg" alt="" />
    <p>Ask a question about the sermons</p>
  </div>
</div>

<div id="input-area">
  <div class="input-inner">
    <div id="error-msg"></div>
    <div class="input-row">
      <textarea id="input" placeholder="Ask about a sermon…" rows="1"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
</div>

<script>
// Theme toggle
(function(){
  var btn = document.getElementById('theme-toggle');
  var cur = document.documentElement.getAttribute('data-theme') || 'dark';
  btn.textContent = cur === 'dark' ? 'Light' : 'Dark';
  btn.addEventListener('click', function(){
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.textContent = next === 'dark' ? 'Light' : 'Dark';
  });
})();

(function () {
  var messages = []
  var busy     = false

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
  newBtn.addEventListener('click', function () { if (!busy) window.open(location.href, '_blank') })

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
    sendBtn.textContent = on ? '…' : 'Send'
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
        return '<li>' + esc(s.title) + ' — ' + esc(s.date) + ' [' + esc(s.timestamp) + ']</li>'
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
              sources = ev.sources || null
            } else if (ev.type === 'delta') {
              if (!bubble) bubble = addAssistantBubble(sources)
              text += ev.text
              bubble.innerHTML = marked.parse(text)
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

    var body = { messages: messages }

    try {
      var res = await fetch('/', {
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
