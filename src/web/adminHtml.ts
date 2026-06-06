import { config } from '../config.js'

export function adminHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry} — Admin</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #000;
      --surface:    #0d0d0d;
      --input-bg:   #0a0a0a;
      --line:       #1f1f1f;
      --line-2:     #2a2a2a;
      --line-3:     #141414;
      --tx:         #fff;
      --tx-cell:    #ccc;
      --tx-label:   #888;
      --tx-sub:     #555;
      --tx-faint:   #666;
      --tx-ghost:   #444;
      --ph:         #3a3a3a;
      --scrub:      #222;
      --accent:     #df4e4e;
      --accent-h:   #c93c3c;
      --dis-bg:     #5a2222;
      --dis-fg:     #8a5555;
      --date-filter: invert(0.4);
      --q-bg: #1a1500; --q-fg: #c4a010; --q-bd: #3a3000;
      --r-bg: #00101a; --r-fg: #3a9fd6; --r-bd: #003050;
      --d-bg: #001a08; --d-fg: #3abf6e; --d-bd: #004020;
      --f-bg: #1c0e0e; --f-fg: #ef8888; --f-bd: #5a2222;
    }
    [data-theme="light"] {
      --bg:         #fff;
      --surface:    #f5f5f5;
      --input-bg:   #fafafa;
      --line:       #e0e0e0;
      --line-2:     #d0d0d0;
      --line-3:     #ebebeb;
      --tx:         #111;
      --tx-cell:    #333;
      --tx-label:   #555;
      --tx-sub:     #777;
      --tx-faint:   #777;
      --tx-ghost:   #999;
      --ph:         #bbb;
      --scrub:      #ccc;
      --accent:     #df4e4e;
      --accent-h:   #c93c3c;
      --dis-bg:     #fadadc;
      --dis-fg:     #b06060;
      --date-filter: none;
      --q-bg: #fffbe8; --q-fg: #8a6d00; --q-bd: #c8b200;
      --r-bg: #e8f4ff; --r-fg: #1a6fa0; --r-bd: #90c0e8;
      --d-bg: #e8fff3; --d-fg: #1a7840; --d-bd: #80d0a0;
      --f-bg: #fff0f0; --f-fg: #c02020; --f-bd: #f0a0a0;
    }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--tx);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top-bar {
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-shrink: 0;
    }
    .top-bar-logo { height: 22px; width: auto; display: block; }
    .top-bar-logo-link { display: contents; }
    .top-bar-divider { width: 1px; height: 20px; background: var(--line-2); }
    .subtitle { color: var(--tx-sub); font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .top-bar-spacer { margin-left: auto; }
    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--line-2);
      border-radius: 5px;
      padding: 0.25rem 0.65rem;
      font-size: 0.76rem;
      cursor: pointer;
      color: var(--tx-sub);
      font-family: inherit;
      letter-spacing: 0.03em;
      transition: border-color 0.15s, color 0.15s;
    }
    .theme-toggle-btn:hover { background: none; border-color: var(--accent); color: var(--tx); }
    .columns {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      overflow: hidden;
    }
    .col {
      padding: 1.5rem;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .col-left { border-right: 1px solid var(--line); }
    .col-right { overflow: hidden; display: flex; flex-direction: column; }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 1.5rem;
    }
    .col-left .card { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .col-right .card { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #jobs-table { flex: 1; overflow-y: auto; min-height: 0; }
    #jobs-table::-webkit-scrollbar { width: 4px; }
    #jobs-table::-webkit-scrollbar-track { background: transparent; }
    #jobs-table::-webkit-scrollbar-thumb { background: var(--scrub); border-radius: 2px; }
    h2 { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tx-sub); margin-bottom: 1rem; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.82rem; font-weight: 500; margin-bottom: 0.3rem; color: var(--tx-label); }
    input, textarea {
      width: 100%; padding: 0.5rem 0.75rem;
      background: var(--input-bg); color: var(--tx);
      border: 1px solid var(--line-2); border-radius: 5px;
      font-size: 0.92rem; font-family: inherit;
      transition: border-color 0.15s;
    }
    input::placeholder, textarea::placeholder { color: var(--ph); }
    input:focus, textarea:focus { outline: none; border-color: var(--accent); }
    input[type="date"]::-webkit-calendar-picker-indicator { filter: var(--date-filter); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    button {
      background: var(--accent); color: #fff;
      border: none; border-radius: 5px;
      padding: 0.6rem 1.25rem; font-size: 0.92rem;
      cursor: pointer; font-family: inherit;
      letter-spacing: 0.02em;
      transition: background 0.15s;
    }
    button:hover { background: var(--accent-h); }
    button:disabled { background: var(--dis-bg); color: var(--dis-fg); cursor: not-allowed; }
    #status-box {
      padding: 0.75rem 1rem; border-radius: 5px;
      font-size: 0.88rem; margin-top: 1rem;
      display: none;
    }
    .status-queued  { background: var(--q-bg); color: var(--q-fg); border: 1px solid var(--q-bd); }
    .status-running { background: var(--r-bg); color: var(--r-fg); border: 1px solid var(--r-bd); }
    .status-done    { background: var(--d-bg); color: var(--d-fg); border: 1px solid var(--d-bd); }
    .status-failed  { background: var(--f-bg); color: var(--f-fg); border: 1px solid var(--f-bd); }
    .status-error   { background: var(--f-bg); color: var(--f-fg); border: 1px solid var(--f-bd); }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); color: var(--tx-ghost); font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line-3); color: var(--tx-cell); }
    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 999px; font-size: 0.72rem; font-weight: 500;
    }
    .badge-queued  { background: var(--q-bg); color: var(--q-fg); }
    .badge-running { background: var(--r-bg); color: var(--r-fg); }
    .badge-done    { background: var(--d-bg); color: var(--d-fg); }
    .badge-failed  { background: var(--f-bg); color: var(--f-fg); }
    .secret-field { margin-bottom: 1.5rem; }
    .retry-btn {
      background: none; color: var(--accent);
      border: 1px solid var(--accent); border-radius: 4px;
      padding: 0.2rem 0.6rem; font-size: 0.75rem;
      cursor: pointer; font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .retry-btn:hover { background: var(--accent); color: #fff; }
  </style>
</head>
<body>

<div class="top-bar">
  <a href="/" target="_blank" rel="noopener noreferrer" class="top-bar-logo-link">
    <img class="top-bar-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
  </a>
  <div class="top-bar-divider"></div>
  <div class="subtitle">Sermon ingestion</div>
  <div class="top-bar-spacer"></div>
  <button type="button" class="theme-toggle-btn" id="theme-toggle">Light</button>
</div>

<div class="columns">
  <div class="col col-left">
    <div class="card">
      <div class="secret-field field">
        <label for="secret">Admin Secret</label>
        <input type="password" id="secret" placeholder="Enter admin secret" autocomplete="current-password">
      </div>

      <h2>New Ingestion</h2>
      <form id="ingest-form">
        <div class="field">
          <label for="downloadUrl">Download URL <span style="color:var(--accent)">*</span></label>
          <input type="url" id="downloadUrl" name="downloadUrl" placeholder="https://example.com/sermon.mp3" required>
        </div>
        <div class="field">
          <label for="webpageUrl">Webpage URL <span style="color:var(--tx-ghost)">(optional)</span></label>
          <input type="url" id="webpageUrl" name="webpageUrl" placeholder="https://church.org/services/2024-03-10">
        </div>
        <div class="row">
          <div class="field">
            <label for="title">Title <span style="color:var(--accent)">*</span></label>
            <input type="text" id="title" name="title" placeholder="Sunday Service" required>
          </div>
          <div class="field">
            <label for="series">Series <span style="color:var(--tx-ghost)">(optional)</span></label>
            <input type="text" id="series" name="series" placeholder="Faith Foundations">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="speaker">Speaker <span style="color:var(--accent)">*</span></label>
            <input type="text" id="speaker" name="speaker" placeholder="Apostle Emmanuel Iren" required>
          </div>
          <div class="field">
            <label for="date">Date <span style="color:var(--accent)">*</span></label>
            <input type="date" id="date" name="date" required>
          </div>
        </div>
        <div class="field">
          <label for="tags">Tags <span style="color:var(--tx-ghost)">(comma-separated, optional)</span></label>
          <input type="text" id="tags" name="tags" placeholder="faith, prayer, healing">
        </div>
        <button type="submit" id="submit-btn">Ingest Sermon</button>
      </form>
      <div id="status-box"></div>
    </div>
  </div>

  <div class="col col-right">
    <div class="card">
      <h2>Recent Jobs <button type="button" id="refresh-btn" style="background:none;border:1px solid var(--line-2);border-radius:4px;padding:0.15rem 0.6rem;font-size:0.75rem;cursor:pointer;color:var(--tx-faint);font-family:inherit;margin-left:0.5rem">Refresh</button></h2>
      <div id="jobs-table"><em style="color:var(--tx-ghost)">No jobs yet.</em></div>
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

  const form = document.getElementById('ingest-form')
  const submitBtn = document.getElementById('submit-btn')
  const statusBox = document.getElementById('status-box')
  const jobsTable = document.getElementById('jobs-table')

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function getSecret() {
    return document.getElementById('secret').value.trim()
  }

  function setFormEnabled(on) {
    form.querySelectorAll('input, textarea, select, button').forEach(function(el) {
      el.disabled = !on
    })
  }

  // Form locked until secret is verified
  setFormEnabled(false)

  var debounceTimer = null
  function scheduleLoadJobs() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(loadJobs, 400)
  }

  document.getElementById('secret').addEventListener('input', scheduleLoadJobs)
  document.getElementById('refresh-btn').addEventListener('click', loadJobs)

  // Event delegation for retry buttons — one listener, no leak on re-render
  jobsTable.addEventListener('click', function(e) {
    var btn = e.target.closest('.retry-btn')
    if (btn) retryJob(btn.dataset.payload)
  })

  function showStatus(text, type) {
    statusBox.textContent = text
    statusBox.className = 'status-' + type
    statusBox.style.display = 'block'
  }

  var VALID_STATUSES = ['queued', 'running', 'done', 'failed']
  function badgeHtml(status) {
    var s = VALID_STATUSES.includes(status) ? status : 'unknown'
    return '<span class="badge badge-' + s + '">' + s + '</span>'
  }

  async function loadJobs() {
    try {
      const res = await fetch('/admin/jobs', {
        headers: { 'X-Admin-Secret': getSecret() }
      })
      if (res.status === 401) { setFormEnabled(false); return }
      if (!res.ok) { jobsTable.innerHTML = '<em style="color:var(--f-fg)">Failed to load jobs (' + res.status + ')</em>'; return }
      setFormEnabled(true)
      const jobs = await res.json()
      if (!jobs.length) { jobsTable.innerHTML = '<em style="color:var(--tx-ghost)">No jobs yet.</em>'; return }
      const succeededUrls = new Set(
        jobs.filter(function(j) { return j.status === 'done' && j.downloadUrl })
            .map(function(j) { return j.downloadUrl })
      )
      const rows = jobs.map(function(j) {
        const t = new Date(j.createdAt).toLocaleString()
        const title = j.title || '—'
        const msg = j.message || j.error || ''
        const retryBtn = (j.status === 'failed' && j.payload && !succeededUrls.has(j.downloadUrl))
          ? '<button class="retry-btn" data-payload="' + escHtml(j.payload) + '">Retry</button>'
          : ''
        return '<tr><td>' + t + '</td><td>' + escHtml(title) + '</td><td>' + badgeHtml(j.status) + '</td><td>' + escHtml(msg) + '</td><td>' + retryBtn + '</td></tr>'
      }).join('')
      jobsTable.innerHTML = '<table><thead><tr><th>Time</th><th>Title</th><th>Status</th><th>Message</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
    } catch (err) {
      console.error('Failed to load jobs:', err)
    }
  }

  async function pollJob(id) {
    var lastStatus = null
    var interval = setInterval(async () => {
      try {
        const res = await fetch('/admin/jobs/' + id, {
          headers: { 'X-Admin-Secret': getSecret() }
        })
        const job = await res.json()
        if (job.status === 'done') {
          clearInterval(interval)
          showStatus('Done: ' + (job.message || 'Sermon ingested'), 'done')
          loadJobs()
        } else if (job.status === 'failed') {
          clearInterval(interval)
          showStatus('Failed: ' + (job.message || job.error || 'Unknown error'), 'failed')
          loadJobs()
        } else if (job.status !== lastStatus) {
          lastStatus = job.status
          showStatus('Status: ' + job.status + '...', job.status)
        }
      } catch {
        clearInterval(interval)
        showStatus('Lost connection while polling.', 'failed')
      }
    }, 3000)
  }

  async function retryJob(payload) {
    const secret = getSecret()
    if (!secret) return
    try {
      const res = await fetch('/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: payload,
      })
      if (!res.ok) { showStatus('Retry failed: ' + res.status, 'failed'); return }
      const { jobId } = await res.json()
      showStatus('Retry queued. Processing...', 'running')
      pollJob(jobId)
      loadJobs()
    } catch (err) {
      showStatus('Retry failed: ' + err.message, 'failed')
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const secret = getSecret()
    if (!secret) { showStatus('Enter your admin secret first.', 'error'); return }

    const tagsRaw = document.getElementById('tags').value.trim()
    const body = {
      downloadUrl: document.getElementById('downloadUrl').value.trim(),
      webpageUrl: document.getElementById('webpageUrl').value.trim() || undefined,
      title:      document.getElementById('title').value.trim(),
      series:     document.getElementById('series').value.trim() || undefined,
      speaker:    document.getElementById('speaker').value.trim(),
      date:       document.getElementById('date').value,
      tags:       tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    }

    showStatus('Queued...', 'queued')

    try {
      const res = await fetch('/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { showStatus('Wrong admin secret.', 'error'); return }
      if (!res.ok) { showStatus('Server error: ' + res.status, 'error'); return }
      const { jobId } = await res.json()
      showStatus('Job queued. Processing...', 'running')
      form.reset()
      pollJob(jobId)
      loadJobs()
    } catch (err) {
      showStatus('Request failed: ' + err.message, 'error')
    }
  })
</script>
</body>
</html>`
}
