import { config } from '../config.js'

export function dbHtml(): string {
  const ministry = config.MINISTRY_NAME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ministry} — DB Browser</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #000;
      --surface:   #0d0d0d;
      --input-bg:  #0a0a0a;
      --raised:    #111;
      --hover-s:   #181818;
      --line:      #1f1f1f;
      --line-2:    #2a2a2a;
      --line-3:    #141414;
      --tx:        #fff;
      --tx-cell:   #bbb;
      --tx-sub:    #555;
      --tx-faint:  #666;
      --tx-dim:    #777;
      --tx-ghost:  #444;
      --tx-ghost-2: #333;
      --tx-ph:     #333;
      --scrub:     #222;
      --null-cell: #2a2a2a;
      --blob-cell: #3a3a3a;
      --accent:    #df4e4e;
      --act-bg:    #1a0808;
      --f-fg:      #ef8888;
    }
    [data-theme="light"] {
      --bg:        #fff;
      --surface:   #f5f5f5;
      --input-bg:  #fafafa;
      --raised:    #ececec;
      --hover-s:   #e4e4e4;
      --line:      #e0e0e0;
      --line-2:    #d0d0d0;
      --line-3:    #e8e8e8;
      --tx:        #111;
      --tx-cell:   #333;
      --tx-sub:    #888;
      --tx-faint:  #777;
      --tx-dim:    #777;
      --tx-ghost:  #999;
      --tx-ghost-2: #aaa;
      --tx-ph:     #aaa;
      --scrub:     #ccc;
      --null-cell: #ccc;
      --blob-cell: #bbb;
      --accent:    #df4e4e;
      --act-bg:    rgba(223,78,78,0.08);
      --f-fg:      #c02020;
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
    .top-bar-right { margin-left: auto; display: flex; align-items: center; gap: 0.75rem; }
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
    .theme-toggle-btn:hover { border-color: var(--accent); color: var(--tx); }
    .secret-input {
      padding: 0.3rem 0.65rem;
      background: var(--input-bg);
      color: var(--tx);
      border: 1px solid var(--line-2);
      border-radius: 5px;
      font-size: 0.8rem;
      font-family: inherit;
      width: 200px;
      transition: border-color 0.15s;
    }
    .secret-input::placeholder { color: var(--tx-ph); }
    .secret-input:focus { outline: none; border-color: var(--tx-ghost); }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 1.25rem 1.5rem;
      gap: 1rem;
      overflow: hidden;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .table-btn {
      background: var(--surface);
      border: 1px solid var(--line-2);
      color: var(--tx-dim);
      border-radius: 5px;
      padding: 0.3rem 0.85rem;
      font-size: 0.8rem;
      font-family: inherit;
      cursor: pointer;
      letter-spacing: 0.02em;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .table-btn:hover { background: var(--hover-s); color: var(--tx-cell); border-color: var(--line); }
    .table-btn.active { background: var(--act-bg); border-color: var(--accent); color: var(--accent); }
    .ctrl-divider { width: 1px; height: 18px; background: var(--line); margin: 0 0.15rem; }
    .icon-btn {
      background: none;
      border: 1px solid var(--line-2);
      color: var(--tx-sub);
      border-radius: 4px;
      padding: 0.25rem 0.65rem;
      font-size: 0.76rem;
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s, border-color 0.15s;
    }
    .icon-btn:hover { background: none; color: var(--tx-cell); border-color: var(--line); }
    .auto-label {
      font-size: 0.76rem;
      color: var(--tx-ghost);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      user-select: none;
    }
    .auto-label input[type="checkbox"] {
      accent-color: var(--accent);
      cursor: pointer;
    }
    .row-count { margin-left: auto; color: var(--tx-ghost); font-size: 0.76rem; }
    .table-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .table-wrap::-webkit-scrollbar { width: 5px; height: 5px; }
    .table-wrap::-webkit-scrollbar-track { background: transparent; }
    .table-wrap::-webkit-scrollbar-thumb { background: var(--scrub); border-radius: 3px; }
    .table-wrap table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .table-wrap th {
      text-align: left;
      padding: 0.5rem 0.9rem;
      border-bottom: 1px solid var(--line);
      color: var(--tx-ghost);
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      position: sticky;
      top: 0;
      background: var(--surface);
      z-index: 1;
      white-space: nowrap;
    }
    .table-wrap td {
      padding: 0.42rem 0.9rem;
      border-bottom: 1px solid var(--line-3);
      color: var(--tx-cell);
      white-space: nowrap;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .table-wrap tr:last-child td { border-bottom: none; }
    .table-wrap tr:hover td { background: var(--raised); }
    .cell-null { color: var(--null-cell) !important; }
    .cell-blob { color: var(--blob-cell) !important; font-style: italic; }
    .empty { color: var(--tx-ghost); font-size: 0.84rem; padding: 2.5rem; text-align: center; }
    .pagination {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }
    .page-btn {
      background: var(--surface);
      border: 1px solid var(--line-2);
      color: var(--tx-faint);
      border-radius: 5px;
      padding: 0.3rem 0.8rem;
      font-size: 0.78rem;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .page-btn:disabled { color: var(--line-2); border-color: var(--hover-s); cursor: not-allowed; }
    .page-btn:not(:disabled):hover { background: var(--hover-s); color: var(--tx-cell); }
    .page-info { font-size: 0.76rem; color: var(--tx-ghost); }
  </style>
</head>
<body>

<div class="top-bar">
  <a href="/" target="_blank" rel="noopener noreferrer" class="top-bar-logo-link">
    <img class="top-bar-logo" src="/assets/cci_logo.svg" alt="${ministry}" />
  </a>
  <div class="top-bar-divider"></div>
  <div class="subtitle">DB Browser</div>
  <div class="top-bar-right">
    <button type="button" class="theme-toggle-btn" id="theme-toggle">Light</button>
    <input class="secret-input" type="password" id="secret" placeholder="Admin secret" autocomplete="current-password">
  </div>
</div>

<div class="main">
  <div class="controls">
    <button class="table-btn active" data-table="sermons">sermons</button>
    <button class="table-btn" data-table="chunks">chunks</button>
    <button class="table-btn" data-table="jobs">jobs</button>
    <div class="ctrl-divider"></div>
    <button class="icon-btn" id="refresh-btn">Refresh</button>
    <label class="auto-label">
      <input type="checkbox" id="auto-refresh"> auto 5s
    </label>
    <span class="row-count" id="row-count"></span>
  </div>

  <div class="table-wrap" id="table-wrap">
    <div class="empty">Enter your admin secret above, then select a table.</div>
  </div>

  <div class="pagination">
    <button class="page-btn" id="prev-btn" disabled>&#8592; Prev</button>
    <span class="page-info" id="page-info"></span>
    <button class="page-btn" id="next-btn" disabled>Next &#8594;</button>
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

  var state = { table: 'sermons', offset: 0, limit: 50, total: 0, autoTimer: null }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function getSecret() { return document.getElementById('secret').value.trim() }

  function truncate(s, max) { return s.length > max ? s.slice(0, max) + '…' : s }

  // Table selector
  document.querySelectorAll('.table-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.table-btn').forEach(function(b) { b.classList.remove('active') })
      btn.classList.add('active')
      state.table = btn.dataset.table
      state.offset = 0
      load()
    })
  })

  document.getElementById('refresh-btn').addEventListener('click', load)

  document.getElementById('prev-btn').addEventListener('click', function() {
    state.offset = Math.max(0, state.offset - state.limit)
    load()
  })

  document.getElementById('next-btn').addEventListener('click', function() {
    state.offset += state.limit
    load()
  })

  document.getElementById('auto-refresh').addEventListener('change', function() {
    clearInterval(state.autoTimer)
    if (this.checked) state.autoTimer = setInterval(load, 5000)
  })

  // Re-load when secret is typed (debounced)
  var secretTimer = null
  document.getElementById('secret').addEventListener('input', function() {
    clearTimeout(secretTimer)
    secretTimer = setTimeout(load, 400)
  })

  async function load() {
    const secret = getSecret()
    const wrap = document.getElementById('table-wrap')
    if (!secret) {
      wrap.innerHTML = '<div class="empty">Enter your admin secret above, then select a table.</div>'
      document.getElementById('row-count').textContent = ''
      document.getElementById('page-info').textContent = ''
      document.getElementById('prev-btn').disabled = true
      document.getElementById('next-btn').disabled = true
      return
    }

    wrap.innerHTML = '<div class="empty">Loading…</div>'

    try {
      const url = '/lyrical-theology/' + state.table + '?limit=' + state.limit + '&offset=' + state.offset
      const res = await fetch(url, { headers: { 'X-Admin-Secret': secret } })

      if (res.status === 401) {
        wrap.innerHTML = '<div class="empty">Unauthorized — check your admin secret.</div>'
        document.getElementById('row-count').textContent = ''
        return
      }
      if (!res.ok) {
        wrap.innerHTML = '<div class="empty">Server error ' + res.status + '</div>'
        return
      }

      const data = await res.json()
      state.total = data.total

      document.getElementById('row-count').textContent =
        data.total.toLocaleString() + ' row' + (data.total !== 1 ? 's' : '')

      const from = data.total === 0 ? 0 : data.offset + 1
      const to = Math.min(data.offset + data.limit, data.total)
      document.getElementById('page-info').textContent =
        data.total === 0 ? '' : from + '–' + to + ' of ' + data.total.toLocaleString()
      document.getElementById('prev-btn').disabled = data.offset === 0
      document.getElementById('next-btn').disabled = to >= data.total

      if (!data.rows.length) {
        wrap.innerHTML = '<div class="empty">No rows.</div>'
        return
      }

      const cols = data.columns
      const thead = '<thead><tr>' +
        cols.map(function(c) { return '<th>' + escHtml(c) + '</th>' }).join('') +
        '</tr></thead>'

      const tbody = '<tbody>' +
        data.rows.map(function(row) {
          return '<tr>' + cols.map(function(col) {
            var val = row[col]
            if (val === null || val === undefined) {
              return '<td class="cell-null">—</td>'
            }
            var s = String(val)
            if (s.startsWith('[blob:')) {
              return '<td class="cell-blob">' + escHtml(s) + '</td>'
            }
            var display = escHtml(truncate(s, 80))
            return s.length > 80
              ? '<td title="' + escHtml(s) + '">' + display + '</td>'
              : '<td>' + display + '</td>'
          }).join('') + '</tr>'
        }).join('') +
        '</tbody>'

      wrap.innerHTML = '<table>' + thead + tbody + '</table>'
    } catch (err) {
      wrap.innerHTML = '<div class="empty" style="color:var(--f-fg)">Error: ' + escHtml(err.message) + '</div>'
    }
  }
</script>
</body>
</html>`
}
