import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getTranscript, ApiError } from '../api/client'
import type { TranscriptView } from '../api/types'
import ThemeToggle from '../components/ThemeToggle'
import { useNav } from '../contexts/NavContext'

function HamburgerIcon() {
  return (
    <svg
      width="20" height="20" viewBox="0 0 20 20"
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2.5" y1="5" x2="17.5" y2="5" />
      <line x1="2.5" y1="10" x2="17.5" y2="10" />
      <line x1="2.5" y1="15" x2="17.5" y2="15" />
    </svg>
  )
}

function clockStamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// Fall back to paragraph splitting when there are no timestamped segments.
function paragraphs(transcript: string): string[] {
  return transcript
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export default function TranscriptViewPage() {
  const { open } = useNav()
  const navigate = useNavigate()
  const { videoId } = useParams<{ videoId: string }>()
  const [data, setData] = useState<TranscriptView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!videoId) return
    let cancelled = false
    getTranscript(videoId)
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) setNotFound(true)
        else setError(err instanceof Error ? err.message : 'Failed to load transcript')
      })
    return () => {
      cancelled = true
    }
  }, [videoId])

  if (notFound) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-ink-dim">Transcript not found.</p>
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          ‹ Transcripts
        </button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-err-text">{error}</p>
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          ‹ Transcripts
        </button>
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-ink-faint">Loading…</div>
  }

  const { sermon, segments, transcript } = data
  const meta = [sermon.speaker, sermon.dateFormatted, sermon.theme].filter(Boolean).join('  •  ')
  const hasBody = segments.length > 0 || transcript.trim().length > 0

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-bg px-4 py-3 sm:px-6">
        <button className="btn-ghost whitespace-nowrap" onClick={() => navigate(-1)}>
          ‹ Transcripts
        </button>
        <div className="flex items-center gap-2">
          <a
            href={`/transcripts/${sermon.videoId}/download`}
            className="btn-primary whitespace-nowrap"
          >
            Download PDF
          </a>
          <ThemeToggle />
          <button
            className="flex items-center justify-center rounded-md border border-line-strong p-1.5 text-ink-dim transition-colors hover:border-accent hover:text-ink-bright sm:hidden"
            aria-label="Open navigation menu"
            onClick={open}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-5 pb-16 pt-7">
        <h1 className="text-2xl font-bold leading-tight text-ink-bright">{sermon.title}</h1>
        {meta && <div className="mt-2 text-[0.85rem] text-ink-dim">{meta}</div>}
        <hr className="my-6 border-line" />

        {!hasBody ? (
          <p className="text-ink-faint">No transcript text available for this sermon.</p>
        ) : segments.length > 0 ? (
          segments.map((seg, i) => (
            <div key={i} className="mb-3.5 flex flex-col gap-1 leading-relaxed sm:flex-row sm:gap-3.5">
              <span className="w-[4.2em] flex-shrink-0 pt-0 text-[0.72rem] tabular-nums text-ink-faint sm:pt-1">
                {clockStamp(seg.start)}
              </span>
              <p className="text-[0.96rem] text-ink">{seg.text.trim()}</p>
            </div>
          ))
        ) : (
          paragraphs(transcript).map((p, i) => (
            <div key={i} className="mb-3.5 leading-relaxed">
              <p className="text-[0.96rem] text-ink">{p}</p>
            </div>
          ))
        )}
      </main>
    </div>
  )
}
