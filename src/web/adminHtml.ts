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
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
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
    .content { flex: 1; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; max-width: 1100px; width: 100%; }
    .card {
      background: #0d0d0d;
      border: 1px solid #1f1f1f;
      border-radius: 8px;
      padding: 1.5rem;
    }
    .secret-row { display: flex; gap: 0.75rem; align-items: flex-end; margin-bottom: 1.5rem; }
    .secret-row label { display: block; font-size: 0.82rem; font-weight: 500; margin-bottom: 0.3rem; color: #888; }
    .secret-row input {
      flex: 1; padding: 0.5rem 0.75rem;
      background: #0a0a0a; color: #fff;
      border: 1px solid #2a2a2a; border-radius: 5px;
      font-size: 0.92rem; font-family: inherit;
    }
    .secret-row input:focus { outline: none; border-color: #df4e4e; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .stat {
      background: #0a0a0a;
      border: 1px solid #1f1f1f;
      border-radius: 6px;
      padding: 1rem 1.25rem;
    }
    .stat-label { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: #555; margin-bottom: 0.4rem; }
    .stat-value { font-size: 1.6rem; font-weight: 600; color: #fff; }
    .stat-sub { font-size: 0.78rem; color: #444; margin-top: 0.2rem; }
    h2 { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #555; margin-bottom: 1rem; }
    .actions { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
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
    .refresh-btn {
      background: none; color: #666;
      border: 1px solid #2a2a2a; border-radius: 4px;
      padding: 0.35rem 0.8rem; font-size: 0.8rem;
    }
    .refresh-btn:hover { background: #111; color: #aaa; }
    #sync-status { font-size: 0.85rem; color: #555; }
    .jobs-scroll { overflow-y: auto; max-height: 420px; }
    .jobs-scroll::-webkit-scrollbar { width: 4px; }
    .jobs-scroll::-webkit-scrollbar-track { background: transparent; }
    .jobs-scroll::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #1f1f1f; color: #444; font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; position: sticky; top: 0; background: #0d0d0d; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #141414; color: #ccc; }
    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 999px; font-size: 0.72rem; font-weight: 500;
    }
    .badge-queued  { background: #1a1500; color: #c4a010; }
    .badge-running { background: #00101a; color: #3a9fd6; }
    .badge-done    { background: #001a08; color: #3abf6e; }
    .badge-failed  { background: #1c0e0e; color: #ef8888; }
  </style>
</head>
<body>

<div class="top-bar">
  <img class="top-bar-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
  <div class="top-bar-divider"></div>
  <div class="subtitle">Ingestion Status</div>
</div>

<div class="content">
  <div class="card">
    <div class="secret-row">
      <div style="flex:1">
        <label for="secret">Admin Secret</label>
        <input type="password" id="secret" placeholder="Enter admin secret to view status" autocomplete="current-password">
      </div>
      <button type="button" id="load-btn">Load</button>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Sermons indexed</div>
        <div class="stat-value" id="stat-count">—</div>
      </div>
      <div class="stat">
        <div class="stat-label">Queue depth</div>
        <div class="stat-value" id="stat-queue">—</div>
        <div class="stat-sub" id="stat-queue-sub"></div>
      </div>
      <div class="stat">
        <div class="stat-label">Last sync</div>
        <div class="stat-value" id="stat-sync" style="font-size:1rem;padding-top:0.3rem">—</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>
      Recent Jobs
      <button type="button" class="refresh-btn" id="refresh-btn" style="margin-left:0.5rem">Refresh</button>
    </h2>
    <div class="actions" style="margin-bottom:1rem">
      <button type="button" id="sync-btn" disabled>Sync Now</button>
      <span id="sync-status"></span>
    </div>
    <div class="jobs-scroll">
      <div id="jobs-table"><em style="color:#444">Enter your admin secret above to view jobs.</em></div>
    </div>
  </div>
</div>

<script>
  var secret = ''
  var autoRefreshTimer = null

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  var VALID_STATUSES = ['queued', 'running', 'done', 'failed']
  function badgeHtml(status) {
    var s = VALID_STATUSES.includes(status) ? status : 'unknown'
    return '<span class="badge badge-' + s + '">' + s + '</span>'
  }

  function fmtDate(iso) {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  function fmtRelative(iso) {
    if (!iso) return '—'
    var diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
    return Math.floor(diff / 86400000) + 'd ago'
  }

  async function loadStatus() {
    var res = await fetch('/admin/status', { headers: { 'X-Admin-Secret': secret } })
    if (!res.ok) return null
    return res.json()
  }

  async function loadJobs() {
    var res = await fetch('/admin/jobs', { headers: { 'X-Admin-Secret': secret } })
    if (!res.ok) return null
    return res.json()
  }

  async function refresh() {
    if (!secret) return
    var results = await Promise.all([loadStatus(), loadJobs()])
    var status = results[0]
    var jobs = results[1]

    if (!status || !jobs) {
      document.getElementById('jobs-table').innerHTML = '<em style="color:#ef8888">Wrong secret or server error.</em>'
      document.getElementById('sync-btn').disabled = true
      return
    }

    document.getElementById('stat-count').textContent = status.sermonCount != null ? String(status.sermonCount) : '—'
    document.getElementById('stat-queue').textContent = String(status.queueDepth || 0)
    document.getElementById('stat-queue-sub').textContent = status.queueDepth > 0 ? 'processing...' : 'idle'
    document.getElementById('stat-sync').textContent = fmtRelative(status.lastSyncAt)
    document.getElementById('sync-btn').disabled = false

    if (!jobs.length) {
      document.getElementById('jobs-table').innerHTML = '<em style="color:#444">No jobs yet.</em>'
      return
    }

    var rows = jobs.map(function(j) {
      var msg = escHtml(j.message || j.error || '')
      var title = escHtml(j.title || '—')
      return '<tr><td style="white-space:nowrap">' + fmtDate(j.createdAt) + '</td><td>' + title + '</td><td>' + badgeHtml(j.status) + '</td><td style="color:#555;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + msg + '</td></tr>'
    }).join('')
    document.getElementById('jobs-table').innerHTML =
      '<table><thead><tr><th>Time</th><th>Title</th><th>Status</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>'
  }

  function startAutoRefresh() {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = setInterval(refresh, 30000)
  }

  document.getElementById('load-btn').addEventListener('click', function() {
    secret = document.getElementById('secret').value.trim()
    if (!secret) return
    refresh().then(startAutoRefresh)
  })

  document.getElementById('secret').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('load-btn').click()
  })

  document.getElementById('refresh-btn').addEventListener('click', refresh)

  document.getElementById('sync-btn').addEventListener('click', async function() {
    this.disabled = true
    document.getElementById('sync-status').textContent = 'Syncing...'
    try {
      var res = await fetch('/admin/sync-api', {
        method: 'POST',
        headers: { 'X-Admin-Secret': secret },
      })
      if (res.ok) {
        document.getElementById('sync-status').textContent = 'Sync started — jobs will appear below.'
        setTimeout(refresh, 3000)
      } else {
        document.getElementById('sync-status').textContent = 'Sync failed (' + res.status + ')'
      }
    } catch (err) {
      document.getElementById('sync-status').textContent = 'Request failed: ' + err.message
    } finally {
      this.disabled = false
    }
  })
</script>
</body>
</html>`
}
