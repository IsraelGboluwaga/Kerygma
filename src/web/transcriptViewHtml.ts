import type { SermonRow } from '../db/queries.js'
import type { TranscriptSegment } from '../ingestion/transcriber.js'
import { formatSermonDate } from './transcriptFormat.js'

function clockStamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function transcriptViewHtml(
  sermon: SermonRow,
  segments: TranscriptSegment[],
  transcript: string
): string {
  // Prefer timestamped segments; fall back to plain paragraphs from the raw text.
  let body: string
  if (segments.length > 0) {
    body = segments
      .map(
        (seg) =>
          `<div class="seg"><span class="ts">${clockStamp(seg.start)}</span><p>${esc(seg.text.trim())}</p></div>`
      )
      .join('')
  } else {
    body = transcript
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((p) => `<div class="seg"><p>${esc(p)}</p></div>`)
      .join('')
  }
  if (!body) body = '<p class="empty">No transcript text available for this sermon.</p>'

  const meta = [sermon.speaker, formatSermonDate(sermon.date), sermon.theme]
    .filter(Boolean)
    .map((x) => esc(String(x)))
    .join('  •  ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(sermon.title)} — Transcript</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #000; color: #e5e5e5; }
    header {
      position: sticky; top: 0; background: #000; border-bottom: 1px solid #1f1f1f;
      padding: 0.75rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    }
    a.back { color: #888; font-size: 0.82rem; text-decoration: none; border: 1px solid #333; border-radius: 6px; padding: 0.35rem 0.8rem; transition: border-color .15s, color .15s; white-space: nowrap; }
    a.back:hover { border-color: #df4e4e; color: #fff; }
    a.download {
      background: #df4e4e; color: #fff; text-decoration: none; border-radius: 8px;
      padding: 0.5rem 1rem; font-size: 0.88rem; white-space: nowrap; transition: background .15s;
    }
    a.download:hover { background: #c93c3c; }

    main { max-width: 760px; margin: 0 auto; padding: 1.8rem 1.2rem 4rem; }
    h1 { font-size: 1.5rem; color: #fff; line-height: 1.25; }
    .meta { color: #777; font-size: 0.85rem; margin-top: 0.5rem; }
    hr { border: none; border-top: 1px solid #1f1f1f; margin: 1.4rem 0; }

    .seg { display: flex; gap: 0.9rem; margin-bottom: 0.9rem; line-height: 1.7; }
    .ts { color: #555; font-size: 0.72rem; font-variant-numeric: tabular-nums; padding-top: 0.3rem; flex-shrink: 0; width: 4.2em; }
    .seg p { font-size: 0.96rem; }
    .empty { color: #666; }

    @media (max-width: 600px) {
      .seg { flex-direction: column; gap: 0.1rem; }
      .ts { padding-top: 0; }
    }
  </style>
</head>
<body>
<header>
  <a class="back" href="/transcripts">‹ Transcripts</a>
  <a class="download" href="/transcripts/${esc(sermon.video_id)}/download">Download PDF</a>
</header>
<main>
  <h1>${esc(sermon.title)}</h1>
  <div class="meta">${meta}</div>
  <hr />
  ${body}
</main>
</body>
</html>`
}
