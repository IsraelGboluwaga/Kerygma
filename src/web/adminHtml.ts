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
      background: #f5f5f5;
      color: #1a1a1a;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top-bar {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 1.5rem;
      flex-shrink: 0;
    }
    h1 { font-size: 1.1rem; font-weight: 600; }
    .subtitle { color: #666; font-size: 0.8rem; }
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
    .col-left { border-right: 1px solid #e5e7eb; }
    .col-right { overflow-y: auto; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .col-left .card { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .col-right .card { min-height: 0; }
    h2 { font-size: 1rem; margin-bottom: 1rem; color: #333; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.3rem; color: #444; }
    input, textarea {
      width: 100%; padding: 0.5rem 0.75rem;
      border: 1px solid #ddd; border-radius: 5px;
      font-size: 0.95rem; font-family: inherit;
      transition: border-color 0.15s;
    }
    input:focus, textarea:focus { outline: none; border-color: #4f46e5; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    button {
      background: #4f46e5; color: white;
      border: none; border-radius: 5px;
      padding: 0.6rem 1.25rem; font-size: 0.95rem;
      cursor: pointer; font-family: inherit;
      transition: background 0.15s;
    }
    button:hover { background: #4338ca; }
    button:disabled { background: #a5b4fc; cursor: not-allowed; }
    #status-box {
      padding: 0.75rem 1rem; border-radius: 5px;
      font-size: 0.9rem; margin-top: 1rem;
      display: none;
    }
    .status-queued  { background: #fef9c3; color: #854d0e; }
    .status-running { background: #dbeafe; color: #1e40af; }
    .status-done    { background: #dcfce7; color: #166534; }
    .status-failed  { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #e5e7eb; color: #555; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; }
    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 999px; font-size: 0.75rem; font-weight: 500;
    }
    .badge-queued  { background: #fef9c3; color: #854d0e; }
    .badge-running { background: #dbeafe; color: #1e40af; }
    .badge-done    { background: #dcfce7; color: #166534; }
    .badge-failed  { background: #fee2e2; color: #991b1b; }
    .secret-field { margin-bottom: 1.5rem; }
    .retry-btn {
      background: none; color: #4f46e5;
      border: 1px solid #4f46e5; border-radius: 4px;
      padding: 0.2rem 0.6rem; font-size: 0.78rem;
      cursor: pointer;
    }
    .retry-btn:hover { background: #eef2ff; }
  </style>
</head>
<body>

<div class="top-bar">
  <h1>${ministry}</h1>
  <div class="subtitle">Sermon ingestion admin</div>
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
          <label for="downloadUrl">Download URL <span style="color:#e11d48">*</span></label>
          <input type="url" id="downloadUrl" name="downloadUrl" placeholder="https://example.com/sermon.mp3" required>
        </div>
        <div class="field">
          <label for="webpageUrl">Webpage URL <span style="color:#9ca3af">(optional)</span></label>
          <input type="url" id="webpageUrl" name="webpageUrl" placeholder="https://church.org/services/2024-03-10">
        </div>
        <div class="row">
          <div class="field">
            <label for="title">Title <span style="color:#e11d48">*</span></label>
            <input type="text" id="title" name="title" placeholder="Sunday Service" required>
          </div>
          <div class="field">
            <label for="series">Series <span style="color:#9ca3af">(optional)</span></label>
            <input type="text" id="series" name="series" placeholder="Faith Foundations">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="speaker">Speaker <span style="color:#e11d48">*</span></label>
            <input type="text" id="speaker" name="speaker" placeholder="Apostle Emmanuel Iren" required>
          </div>
          <div class="field">
            <label for="date">Date <span style="color:#e11d48">*</span></label>
            <input type="date" id="date" name="date" required>
          </div>
        </div>
        <div class="field">
          <label for="tags">Tags <span style="color:#9ca3af">(comma-separated, optional)</span></label>
          <input type="text" id="tags" name="tags" placeholder="faith, prayer, healing">
        </div>
        <button type="submit" id="submit-btn">Ingest Sermon</button>
      </form>
      <div id="status-box"></div>
    </div>
  </div>

  <div class="col col-right">
    <div class="card">
      <h2>Recent Jobs <button type="button" id="refresh-btn" style="background:none;border:1px solid #d1d5db;border-radius:4px;padding:0.15rem 0.6rem;font-size:0.78rem;cursor:pointer;color:#374151;font-family:inherit;margin-left:0.5rem">Refresh</button></h2>
      <div id="jobs-table"><em style="color:#9ca3af">No jobs yet.</em></div>
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
      if (!res.ok) { jobsTable.innerHTML = '<em style="color:#991b1b">Failed to load jobs (' + res.status + ')</em>'; return }
      setFormEnabled(true)
      const jobs = await res.json()
      if (!jobs.length) { jobsTable.innerHTML = '<em style="color:#9ca3af">No jobs yet.</em>'; return }
      const succeededUrls = new Set(
        jobs.filter(function(j) { return j.status === 'done' && j.downloadUrl })
            .map(function(j) { return j.downloadUrl })
      )
      const rows = jobs.map(function(j) {
        const t = new Date(j.createdAt).toLocaleString()
        const title = j.title || '\u2014'
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
