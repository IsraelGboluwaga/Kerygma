import { config } from '../config.js'

/**
 * Live, read-only status dashboard served at GET /admin/status.
 * Polls GET /admin/status/data every 2s and renders the active job's phase
 * stepper plus the current queue — transparency without touching the logs.
 */
export function statusHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry} — Ingestion Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #000; color: #fff;
      min-height: 100dvh; display: flex; flex-direction: column;
    }
    .top-bar {
      background: #000; border-bottom: 1px solid #1f1f1f;
      padding: 0.75rem 1.5rem; display: flex; align-items: center; gap: 1rem; flex-shrink: 0;
    }
    .top-bar-logo { height: 22px; width: auto; display: block; }
    .top-bar-divider { width: 1px; height: 20px; background: #2a2a2a; }
    .subtitle { color: #555; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .top-bar a { margin-left: auto; color: #666; font-size: 0.8rem; text-decoration: none; }
    .top-bar a:hover { color: #df4e4e; }
    main { flex: 1; padding: 1.5rem; max-width: 880px; width: 100%; margin: 0 auto; }
    .card {
      background: #0d0d0d; border: 1px solid #1f1f1f; border-radius: 8px;
      padding: 1.5rem; margin-bottom: 1.25rem;
    }
    h2 { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #555; margin-bottom: 1rem; }
    label { display: block; font-size: 0.82rem; font-weight: 500; margin-bottom: 0.3rem; color: #888; }
    input {
      width: 100%; padding: 0.5rem 0.75rem; background: #0a0a0a; color: #fff;
      border: 1px solid #2a2a2a; border-radius: 5px; font-size: 0.92rem; font-family: inherit;
    }
    input:focus { outline: none; border-color: #df4e4e; }
    .now-title { font-size: 1.05rem; font-weight: 600; margin-bottom: 1.25rem; color: #eee; }
    .idle { color: #444; font-style: italic; }
    /* Phase stepper */
    .stepper { display: flex; align-items: center; gap: 0; }
    .step { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; flex: 0 0 auto; }
    .dot {
      width: 28px; height: 28px; border-radius: 999px; border: 2px solid #2a2a2a;
      display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: #444; background: #0a0a0a;
    }
    .step-label { font-size: 0.72rem; color: #555; letter-spacing: 0.03em; }
    .step.done .dot { border-color: #004020; background: #001a08; color: #3abf6e; }
    .step.done .step-label { color: #3abf6e; }
    .step.active .dot { border-color: #3a9fd6; background: #00101a; color: #3a9fd6; animation: pulse 1.4s ease-in-out infinite; }
    .step.active .step-label { color: #3a9fd6; }
    .connector { height: 2px; width: 38px; background: #222; margin: 0 0.1rem; margin-bottom: 1.3rem; flex: 1; }
    .connector.done { background: #004020; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #1f1f1f; color: #444; font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #141414; color: #ccc; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 500; }
    .badge-queued  { background: #1a1500; color: #c4a010; }
    .badge-running { background: #00101a; color: #3a9fd6; }
    .badge-done    { background: #001a08; color: #3abf6e; }
    .badge-failed  { background: #1c0e0e; color: #ef8888; }
    .pos { color: #c4a010; font-variant-numeric: tabular-nums; }
    .muted { color: #444; font-style: italic; }
    .err { color: #ef8888; }
    .dim { color: #555; font-size: 0.78rem; }
  </style>
</head>
<body>

<div class="top-bar">
  <img class="top-bar-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
  <div class="top-bar-divider"></div>
  <div class="subtitle">Ingestion status</div>
  <a href="/admin">← Admin</a>
</div>

<main>
  <div class="card" id="secret-card">
    <label for="secret">Admin Secret</label>
    <input type="password" id="secret" placeholder="Enter admin secret to view status" autocomplete="current-password">
  </div>

  <div class="card">
    <h2>Now Processing</h2>
    <div id="now"><span class="idle">Waiting for status…</span></div>
  </div>

  <div class="card">
    <h2>Queue</h2>
    <div id="queue"><span class="muted">—</span></div>
  </div>

  <div class="card">
    <h2>Recent</h2>
    <div id="recent"><span class="muted">—</span></div>
  </div>
  <p class="dim" id="footer">Auto-refreshing every 2s.</p>
</main>

<script>
  var PHASES = [
    { key: 'downloading',  label: 'Download' },
    { key: 'transcribing', label: 'Transcribe' },
    { key: 'chunking',     label: 'Chunk' },
    { key: 'embedding',    label: 'Embed' }
  ]
  var VALID = ['queued', 'running', 'done', 'failed']

  var secretInput = document.getElementById('secret')
  secretInput.value = sessionStorage.getItem('adminSecret') || ''
  secretInput.addEventListener('input', function () {
    sessionStorage.setItem('adminSecret', secretInput.value.trim())
    refresh()
  })

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }
  function badge(status) {
    var s = VALID.indexOf(status) !== -1 ? status : 'queued'
    return '<span class="badge badge-' + s + '">' + s + '</span>'
  }

  function stepperHtml(currentPhase) {
    var idx = PHASES.map(function (p) { return p.key }).indexOf(currentPhase)
    var html = '<div class="stepper">'
    PHASES.forEach(function (p, i) {
      var cls = i < idx ? 'done' : (i === idx ? 'active' : '')
      var mark = i < idx ? '✓' : (i + 1)
      html += '<div class="step ' + cls + '"><div class="dot">' + mark + '</div>'
            + '<div class="step-label">' + p.label + '</div></div>'
      if (i < PHASES.length - 1) {
        html += '<div class="connector ' + (i < idx ? 'done' : '') + '"></div>'
      }
    })
    return html + '</div>'
  }

  function renderNow(running) {
    var now = document.getElementById('now')
    if (!running) {
      now.innerHTML = '<span class="idle">Idle — nothing is processing right now.</span>'
      return
    }
    var title = escHtml(running.title || 'Untitled')
    var started = running.startedAt ? ' <span class="dim">· started ' + new Date(running.startedAt).toLocaleTimeString() + '</span>' : ''
    now.innerHTML = '<div class="now-title">' + title + started + '</div>' + stepperHtml(running.phase)
  }

  function renderQueue(queued) {
    var el = document.getElementById('queue')
    if (!queued.length) { el.innerHTML = '<span class="muted">Queue is empty.</span>'; return }
    var rows = queued
      .sort(function (a, b) { return (a.position || 99) - (b.position || 99) })
      .map(function (j) {
        var pos = j.position != null ? '#' + j.position : '—'
        return '<tr><td class="pos">' + pos + '</td><td>' + escHtml(j.title || '—') + '</td></tr>'
      }).join('')
    el.innerHTML = '<table><thead><tr><th>Position</th><th>Title</th></tr></thead><tbody>' + rows + '</tbody></table>'
  }

  function renderRecent(recent) {
    var el = document.getElementById('recent')
    if (!recent.length) { el.innerHTML = '<span class="muted">No finished jobs yet.</span>'; return }
    var rows = recent.slice(0, 10).map(function (j) {
      var when = j.completedAt ? new Date(j.completedAt).toLocaleString() : new Date(j.createdAt).toLocaleString()
      var msg = j.message || j.error || ''
      var msgCls = j.status === 'failed' ? ' class="err"' : ''
      return '<tr><td>' + when + '</td><td>' + escHtml(j.title || '—') + '</td><td>' + badge(j.status)
           + '</td><td' + msgCls + '>' + escHtml(msg) + '</td></tr>'
    }).join('')
    el.innerHTML = '<table><thead><tr><th>Time</th><th>Title</th><th>Status</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>'
  }

  async function refresh() {
    var secret = secretInput.value.trim()
    if (!secret) { document.getElementById('now').innerHTML = '<span class="idle">Enter the admin secret to view status.</span>'; return }
    try {
      var res = await fetch('/admin/status/data', { headers: { 'X-Admin-Secret': secret } })
      if (res.status === 401) { document.getElementById('now').innerHTML = '<span class="err">Wrong admin secret.</span>'; return }
      if (!res.ok) { document.getElementById('footer').innerHTML = '<span class="err">Failed to load (' + res.status + ')</span>'; return }
      var data = await res.json()
      var jobs = data.jobs || []
      renderNow(jobs.find(function (j) { return j.status === 'running' }))
      renderQueue(jobs.filter(function (j) { return j.status === 'queued' }))
      renderRecent(jobs.filter(function (j) { return j.status === 'done' || j.status === 'failed' }))
      document.getElementById('footer').textContent = 'Queue depth: ' + (data.queueDepth || 0) + ' · updated ' + new Date().toLocaleTimeString()
    } catch (err) {
      document.getElementById('footer').innerHTML = '<span class="err">Connection lost — retrying…</span>'
    }
  }

  refresh()
  setInterval(refresh, 2000)
</script>
</body>
</html>`
}
