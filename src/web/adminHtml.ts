import { config } from '../config.js'

export function adminHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry} — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #000;
      color: #fff;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top-bar {
      background: #000;
      border-bottom: 1px solid #1f1f1f;
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-shrink: 0;
    }
    .top-bar-logo { height: 22px; width: auto; display: block; }
    .top-bar-divider { width: 1px; height: 20px; background: #2a2a2a; }
    .subtitle { color: #555; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
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
    .col-left { border-right: 1px solid #1f1f1f; }
    .col-right { overflow: hidden; display: flex; flex-direction: column; }
    .card {
      background: #0d0d0d;
      border: 1px solid #1f1f1f;
      border-radius: 8px;
      padding: 1.5rem;
    }
    .col-left .card { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .col-right .card { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #jobs-table { flex: 1; overflow-y: auto; min-height: 0; }
    #jobs-table::-webkit-scrollbar { width: 4px; }
    #jobs-table::-webkit-scrollbar-track { background: transparent; }
    #jobs-table::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
    h2 { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #555; margin-bottom: 1rem; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.82rem; font-weight: 500; margin-bottom: 0.3rem; color: #888; }
    input, textarea {
      width: 100%; padding: 0.5rem 0.75rem;
      background: #0a0a0a; color: #fff;
      border: 1px solid #2a2a2a; border-radius: 5px;
      font-size: 0.92rem; font-family: inherit;
      transition: border-color 0.15s;
    }
    input::placeholder, textarea::placeholder { color: #3a3a3a; }
    input:focus, textarea:focus { outline: none; border-color: #df4e4e; }
    input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.4); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    button {
      background: #df4e4e; color: #fff;
      border: none; border-radius: 5px;
      padding: 0.6rem 1.25rem; font-size: 0.92rem;
      cursor: pointer; font-family: inherit;
      letter-spacing: 0.02em;
      transition: background 0.15s;
    }
    button:hover { background: #c93c3c; }
    button:disabled { background: #5a2222; color: #8a5555; cursor: not-allowed; }
    #status-box {
      padding: 0.75rem 1rem; border-radius: 5px;
      font-size: 0.88rem; margin-top: 1rem;
      display: none;
    }
    .status-queued  { background: #1a1500; color: #c4a010; border: 1px solid #3a3000; }
    .status-running { background: #00101a; color: #3a9fd6; border: 1px solid #003050; }
    .status-done    { background: #001a08; color: #3abf6e; border: 1px solid #004020; }
    .status-failed  { background: #1c0e0e; color: #ef8888; border: 1px solid #5a2222; }
    .status-error   { background: #1c0e0e; color: #ef8888; border: 1px solid #5a2222; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #1f1f1f; color: #444; font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #141414; color: #ccc; }
    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 999px; font-size: 0.72rem; font-weight: 500;
    }
    .badge-queued  { background: #1a1500; color: #c4a010; }
    .badge-running { background: #00101a; color: #3a9fd6; }
    .badge-done    { background: #001a08; color: #3abf6e; }
    .badge-failed  { background: #1c0e0e; color: #ef8888; }
    .secret-field { margin-bottom: 1.5rem; }
    .retry-btn {
      background: none; color: #df4e4e;
      border: 1px solid #df4e4e; border-radius: 4px;
      padding: 0.2rem 0.6rem; font-size: 0.75rem;
      cursor: pointer; font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .retry-btn:hover { background: #df4e4e; color: #fff; }
  </style>
</head>
<body>

<div class="top-bar">
  <img class="top-bar-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
  <div class="top-bar-divider"></div>
  <div class="subtitle">Sermon ingestion</div>
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
          <label for="downloadUrl">Download URL <span style="color:#df4e4e">*</span></label>
          <input type="url" id="downloadUrl" name="downloadUrl" placeholder="https://example.com/sermon.mp3" required>
        </div>
        <div class="field">
          <label for="webpageUrl">Webpage URL <span style="color:#444">(optional)</span></label>
          <input type="url" id="webpageUrl" name="webpageUrl" placeholder="https://church.org/services/2024-03-10">
        </div>
        <div class="row">
          <div class="field">
            <label for="title">Title <span style="color:#df4e4e">*</span></label>
            <input type="text" id="title" name="title" placeholder="Sunday Service" required>
          </div>
          <div class="field">
            <label for="series">Series <span style="color:#444">(optional)</span></label>
            <input type="text" id="series" name="series" placeholder="Faith Foundations">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="speaker">Speaker <span style="color:#df4e4e">*</span></label>
            <input type="text" id="speaker" name="speaker" placeholder="Apostle Emmanuel Iren" required>
          </div>
          <div class="field">
            <label for="date">Date <span style="color:#df4e4e">*</span></label>
            <input type="date" id="date" name="date" required>
          </div>
        </div>
        <div class="field">
          <label for="tags">Tags <span style="color:#444">(comma-separated, optional)</span></label>
          <input type="text" id="tags" name="tags" placeholder="faith, prayer, healing">
        </div>
        <button type="submit" id="submit-btn">Ingest Sermon</button>
      </form>
      <div id="status-box"></div>
    </div>
  </div>

  <div class="col col-right">
    <div class="card">
      <h2>Recent Jobs <button type="button" id="refresh-btn" style="background:none;border:1px solid #2a2a2a;border-radius:4px;padding:0.15rem 0.6rem;font-size:0.75rem;cursor:pointer;color:#666;font-family:inherit;margin-left:0.5rem">Refresh</button></h2>
      <div id="jobs-table"><em style="color:#444">No jobs yet.</em></div>
    </div>
  </div>
</div>

<script>
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
      if (!res.ok) { jobsTable.innerHTML = '<em style="color:#ef8888">Failed to load jobs (' + res.status + ')</em>'; return }
      setFormEnabled(true)
      const jobs = await res.json()
      if (!jobs.length) { jobsTable.innerHTML = '<em style="color:#444">No jobs yet.</em>'; return }
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
