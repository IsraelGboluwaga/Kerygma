export function adminHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kerygma Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      color: #1a1a1a;
      padding: 2rem 1rem;
    }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; margin-bottom: 2rem; font-size: 0.9rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
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
    .status-pending  { background: #fef9c3; color: #854d0e; }
    .status-running  { background: #dbeafe; color: #1e40af; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-error    { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #e5e7eb; color: #555; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; }
    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 999px; font-size: 0.75rem; font-weight: 500;
    }
    .badge-pending   { background: #fef9c3; color: #854d0e; }
    .badge-running   { background: #dbeafe; color: #1e40af; }
    .badge-completed { background: #dcfce7; color: #166534; }
    .badge-error     { background: #fee2e2; color: #991b1b; }
    .secret-field { margin-bottom: 1.5rem; }
  </style>
</head>
<body>
<div class="container">
  <h1>Kerygma Admin</h1>
  <p class="subtitle">Ingest a sermon MP3 into the knowledge base.</p>

  <div class="card">
    <div class="secret-field field">
      <label for="secret">Admin Secret</label>
      <input type="password" id="secret" placeholder="Enter admin secret" autocomplete="current-password">
    </div>

    <h2>New Ingestion</h2>
    <form id="ingest-form">
      <div class="field">
        <label for="mp3Url">MP3 URL <span style="color:#e11d48">*</span></label>
        <input type="url" id="mp3Url" name="mp3Url" placeholder="https://example.com/sermon.mp3" required>
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
          <label for="speaker">Speaker <span style="color:#e11d48">*</span></label>
          <input type="text" id="speaker" name="speaker" placeholder="Apostle Emmanuel Iren" required>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="date">Date <span style="color:#e11d48">*</span></label>
          <input type="date" id="date" name="date" required>
        </div>
        <div class="field">
          <label for="tags">Tags <span style="color:#9ca3af">(comma-separated)</span></label>
          <input type="text" id="tags" name="tags" placeholder="faith, prayer, healing">
        </div>
      </div>
      <button type="submit" id="submit-btn">Ingest Sermon</button>
    </form>
    <div id="status-box"></div>
  </div>

  <div class="card">
    <h2>Recent Jobs</h2>
    <div id="jobs-table"><em style="color:#9ca3af">No jobs yet.</em></div>
  </div>
</div>

<script>
  const form = document.getElementById('ingest-form')
  const submitBtn = document.getElementById('submit-btn')
  const statusBox = document.getElementById('status-box')
  const jobsTable = document.getElementById('jobs-table')

  function getSecret() {
    return document.getElementById('secret').value.trim()
  }

  function showStatus(text, type) {
    statusBox.textContent = text
    statusBox.className = 'status-' + type
    statusBox.style.display = 'block'
  }

  function badgeHtml(status) {
    return '<span class="badge badge-' + status + '">' + status + '</span>'
  }

  async function loadJobs() {
    try {
      const res = await fetch('/admin/jobs', {
        headers: { 'X-Admin-Secret': getSecret() }
      })
      if (!res.ok) return
      const jobs = await res.json()
      if (!jobs.length) return
      const rows = jobs.map(j => {
        const t = new Date(j.createdAt).toLocaleTimeString()
        const msg = j.error || (j.result && j.result.message) || ''
        return '<tr><td>' + t + '</td><td>' + badgeHtml(j.status) + '</td><td>' + msg + '</td></tr>'
      }).join('')
      jobsTable.innerHTML = '<table><thead><tr><th>Time</th><th>Status</th><th>Message</th></tr></thead><tbody>' + rows + '</tbody></table>'
    } catch {}
  }

  async function pollJob(id) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/admin/jobs/' + id, {
          headers: { 'X-Admin-Secret': getSecret() }
        })
        const job = await res.json()
        if (job.status === 'completed') {
          clearInterval(interval)
          const msg = (job.result && job.result.message) || 'Done'
          showStatus('Done: ' + msg, 'completed')
          submitBtn.disabled = false
          loadJobs()
        } else if (job.status === 'error') {
          clearInterval(interval)
          showStatus('Error: ' + (job.error || 'Unknown error'), 'error')
          submitBtn.disabled = false
          loadJobs()
        } else {
          showStatus('Status: ' + job.status + '...', job.status)
        }
      } catch {
        clearInterval(interval)
        showStatus('Lost connection while polling.', 'error')
        submitBtn.disabled = false
      }
    }, 3000)
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const secret = getSecret()
    if (!secret) { showStatus('Enter your admin secret first.', 'error'); return }

    const tagsRaw = document.getElementById('tags').value.trim()
    const body = {
      mp3Url:     document.getElementById('mp3Url').value.trim(),
      webpageUrl: document.getElementById('webpageUrl').value.trim() || undefined,
      title:      document.getElementById('title').value.trim(),
      speaker:    document.getElementById('speaker').value.trim(),
      date:       document.getElementById('date').value,
      tags:       tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    }

    submitBtn.disabled = true
    showStatus('Queued...', 'pending')

    try {
      const res = await fetch('/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { showStatus('Wrong admin secret.', 'error'); submitBtn.disabled = false; return }
      if (!res.ok) { showStatus('Server error: ' + res.status, 'error'); submitBtn.disabled = false; return }
      const { jobId } = await res.json()
      showStatus('Job queued (id: ' + jobId + '). Processing...', 'running')
      pollJob(jobId)
      loadJobs()
    } catch (err) {
      showStatus('Request failed: ' + err.message, 'error')
      submitBtn.disabled = false
    }
  })

  // Load jobs on page open
  loadJobs()
</script>
</body>
</html>`
}
