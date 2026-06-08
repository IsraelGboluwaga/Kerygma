import { config } from '../config.js'
import type { ThemeRow } from '../db/queries.js'

export function transcriptsHtml(themes: ThemeRow[]): string {
  const ministry = config.MINISTRY_NAME
  const themeOptions = themes
    .map((t) => `<option value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</option>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcripts — ${ministry}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #000; color: #fff; min-height: 100dvh;
      display: flex; flex-direction: column;
    }
    header {
      background: #000; border-bottom: 1px solid #1f1f1f;
      padding: 0.75rem 1.5rem; display: flex; align-items: center;
      justify-content: space-between; flex-shrink: 0;
    }
    .header-logo { height: 28px; width: auto; display: block; }
    .subtitle { font-size: 0.72rem; color: #555; margin-top: 0.25rem; letter-spacing: 0.06em; text-transform: uppercase; }
    a.home-link { color: #888; font-size: 0.82rem; text-decoration: none; border: 1px solid #333; border-radius: 6px; padding: 0.35rem 0.8rem; transition: border-color .15s, color .15s; }
    a.home-link:hover { border-color: #df4e4e; color: #fff; }

    main { flex: 1; width: 100%; max-width: 980px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }

    .search-card { background: #0d0d0d; border: 1px solid #1f1f1f; border-radius: 12px; padding: 1rem; }
    .search-row { display: flex; gap: 0.6rem; }
    #q {
      flex: 1; padding: 0.7rem 0.9rem; border: 1px solid #2a2a2a; border-radius: 8px;
      background: #000; color: #fff; font-size: 0.95rem; font-family: inherit;
    }
    #q::placeholder { color: #444; }
    #q:focus { outline: none; border-color: #df4e4e; }
    button.primary {
      background: #df4e4e; color: #fff; border: none; border-radius: 8px;
      padding: 0.7rem 1.2rem; font-size: 0.95rem; font-family: inherit; cursor: pointer;
      letter-spacing: 0.03em; transition: background .15s; flex-shrink: 0;
    }
    button.primary:hover:not(:disabled) { background: #c93c3c; }
    button.primary:disabled { background: #5a2222; color: #8a5555; cursor: not-allowed; }

    .filters-toggle { margin-top: 0.7rem; font-size: 0.8rem; color: #777; cursor: pointer; user-select: none; background: none; border: none; font-family: inherit; padding: 0; }
    .filters-toggle:hover { color: #aaa; }
    .filters { margin-top: 0.8rem; display: none; flex-wrap: wrap; gap: 0.6rem; }
    .filters.open { display: flex; }
    .filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; color: #777; letter-spacing: 0.04em; text-transform: uppercase; }
    .filters select, .filters input {
      padding: 0.5rem 0.6rem; border: 1px solid #2a2a2a; border-radius: 6px;
      background: #000; color: #fff; font-size: 0.88rem; font-family: inherit; min-width: 130px;
    }
    .filters select:focus, .filters input:focus { outline: none; border-color: #df4e4e; }

    #status { margin: 1.2rem 0 0.6rem; font-size: 0.82rem; color: #777; min-height: 1.2em; }
    #error { color: #ef8888; }

    /* Responsive table: real table on wide screens, cards on narrow */
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    thead th { text-align: left; font-weight: 600; color: #888; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 0.7rem; border-bottom: 1px solid #222; }
    tbody td { padding: 0.75rem 0.7rem; border-bottom: 1px solid #161616; vertical-align: top; }
    .t-title a { color: #fff; text-decoration: none; font-weight: 600; }
    .t-title a:hover { color: #df4e4e; text-decoration: underline; }
    .t-excerpt { color: #777; font-size: 0.82rem; margin-top: 0.25rem; max-width: 42ch; }
    .t-theme span { display: inline-block; background: #1a1414; color: #e89; border: 1px solid #3a2222; border-radius: 999px; padding: 0.15rem 0.6rem; font-size: 0.75rem; }
    .t-date { color: #bbb; white-space: nowrap; }
    .dl { color: #df4e4e; text-decoration: none; font-size: 0.85rem; white-space: nowrap; border: 1px solid #3a2222; border-radius: 6px; padding: 0.35rem 0.7rem; transition: background .15s; }
    .dl:hover { background: #1a0e0e; }

    @media (max-width: 640px) {
      thead { display: none; }
      table, tbody, tr, td { display: block; width: 100%; }
      tbody tr { border: 1px solid #1f1f1f; border-radius: 10px; margin-bottom: 0.8rem; padding: 0.3rem 0.2rem; }
      tbody td { border: none; padding: 0.4rem 0.8rem; }
      tbody td.t-cell::before { content: attr(data-label); display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-bottom: 0.15rem; }
    }
  </style>
</head>
<body>
<header>
  <div>
    <img class="header-logo" src="/assets/full_logo.png" alt="${ministry}" onerror="this.style.display='none'" />
    <div class="subtitle">Transcripts</div>
  </div>
  <a class="home-link" href="/">Chat ›</a>
</header>

<main>
  <div class="search-card">
    <div class="search-row">
      <input id="q" type="text" placeholder="e.g. sermons in February 2023, or all sermons on faith" autofocus />
      <button class="primary" id="search-btn">Search</button>
    </div>
    <button class="filters-toggle" id="filters-toggle" type="button">Filters ▾</button>
    <div class="filters" id="filters">
      <label>Month
        <select id="f-month">
          <option value="">Any</option>
          <option value="01">January</option><option value="02">February</option>
          <option value="03">March</option><option value="04">April</option>
          <option value="05">May</option><option value="06">June</option>
          <option value="07">July</option><option value="08">August</option>
          <option value="09">September</option><option value="10">October</option>
          <option value="11">November</option><option value="12">December</option>
        </select>
      </label>
      <label>Year
        <input id="f-year" type="number" inputmode="numeric" placeholder="2023" min="1990" max="2100" />
      </label>
      <label>Theme
        <select id="f-theme"><option value="">Any</option>${themeOptions}</select>
      </label>
      <label>Speaker
        <input id="f-speaker" type="text" placeholder="name" />
      </label>
    </div>
  </div>

  <div id="status"></div>
  <div id="results"></div>
</main>

<script>
(function () {
  var qEl = document.getElementById('q')
  var btn = document.getElementById('search-btn')
  var statusEl = document.getElementById('status')
  var resultsEl = document.getElementById('results')
  var filters = document.getElementById('filters')

  document.getElementById('filters-toggle').addEventListener('click', function () {
    filters.classList.toggle('open')
  })
  qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch() })
  btn.addEventListener('click', doSearch)

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function buildParams() {
    var q = qEl.value.trim()
    if (q) return 'q=' + encodeURIComponent(q)
    var p = []
    var month = document.getElementById('f-month').value
    var year = document.getElementById('f-year').value.trim()
    var theme = document.getElementById('f-theme').value
    var speaker = document.getElementById('f-speaker').value.trim()
    if (year) p.push('year=' + encodeURIComponent(year))
    if (month) p.push('month=' + encodeURIComponent(month))
    if (theme) p.push('theme=' + encodeURIComponent(theme))
    if (speaker) p.push('speaker=' + encodeURIComponent(speaker))
    return p.join('&')
  }

  function render(data) {
    var rows = data.sermons || []
    if (data.interpreted) statusEl.innerHTML = esc(data.interpreted)
    else statusEl.textContent = rows.length + (rows.length === 1 ? ' transcript' : ' transcripts')

    if (rows.length === 0) {
      resultsEl.innerHTML = '<p style="color:#666;font-size:.9rem;margin-top:1rem">No matching transcripts found.</p>'
      return
    }

    var body = rows.map(function (r) {
      var titleCell = '<div class="t-title"><a href="' + esc(r.viewUrl) + '">' + esc(r.title) + '</a></div>'
        + (r.excerpt ? '<div class="t-excerpt">' + esc(r.excerpt) + '</div>' : '')
      var theme = r.theme ? '<span>' + esc(r.theme) + '</span>' : '<span style="opacity:.4">—</span>'
      var dl = r.hasTranscript
        ? '<a class="dl" href="' + esc(r.downloadUrl) + '">Download PDF</a>'
        : '<span style="color:#555;font-size:.8rem">unavailable</span>'
      return '<tr>'
        + '<td class="t-cell" data-label="Title">' + titleCell + '</td>'
        + '<td class="t-cell t-date" data-label="Date">' + esc(r.dateFormatted) + '</td>'
        + '<td class="t-cell t-theme" data-label="Theme">' + theme + '</td>'
        + '<td class="t-cell" data-label="Transcript">' + dl + '</td>'
        + '</tr>'
    }).join('')

    resultsEl.innerHTML =
      '<table><thead><tr><th>Title</th><th>Date</th><th>Theme</th><th>Transcript</th></tr></thead><tbody>'
      + body + '</tbody></table>'
  }

  function doSearch() {
    var params = buildParams()
    if (!params) { statusEl.textContent = 'Enter a search or pick a filter.'; return }
    btn.disabled = true
    statusEl.classList.remove('error' )
    statusEl.textContent = 'Searching…'
    resultsEl.innerHTML = ''
    fetch('/transcripts/search?' + params)
      .then(function (res) {
        return res.json().then(function (b) {
          if (!res.ok) throw new Error(b.error || 'Search failed')
          return b
        })
      })
      .then(render)
      .catch(function (err) {
        statusEl.innerHTML = '<span id="error">' + esc(err.message) + '</span>'
      })
      .finally(function () { btn.disabled = false })
  }
})()
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
