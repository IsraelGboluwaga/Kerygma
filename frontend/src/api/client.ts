import type {
  AdminStatus,
  ChatEvent,
  ChatMessage,
  DbTablePage,
  Job,
  StatusData,
  ThemeOption,
  TranscriptSearchResult,
  TranscriptView,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

function adminHeaders(secret: string): HeadersInit {
  return { 'X-Admin-Secret': secret }
}

// ── Public endpoints ────────────────────────────────────────────────────────

export async function searchTranscripts(params: string): Promise<TranscriptSearchResult> {
  return asJson(await fetch(`/api/transcripts/search?${params}`))
}

export async function getTranscript(videoId: string): Promise<TranscriptView> {
  return asJson(await fetch(`/api/transcripts/${encodeURIComponent(videoId)}`))
}

export async function listThemes(): Promise<ThemeOption[]> {
  return asJson(await fetch('/api/themes'))
}

/**
 * Open the agentic chat SSE stream and yield parsed events. The backend frames
 * each event as `data: {json}\n\n`; sources can arrive before the answer text.
 */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (!res.ok || !res.body) {
    let message = `Server error (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* keep generic */
    }
    throw new ApiError(message, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            yield JSON.parse(line.slice(6)) as ChatEvent
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Admin endpoints (X-Admin-Secret) ────────────────────────────────────────

export async function getAdminStatus(secret: string): Promise<AdminStatus> {
  return asJson(await fetch('/api/admin/status', { headers: adminHeaders(secret) }))
}

export async function getAdminJobs(secret: string): Promise<Job[]> {
  return asJson(await fetch('/api/admin/jobs', { headers: adminHeaders(secret) }))
}

export async function getStatusData(secret: string): Promise<StatusData> {
  return asJson(await fetch('/api/admin/status/data', { headers: adminHeaders(secret) }))
}

export async function syncApi(secret: string): Promise<{ ok: boolean }> {
  return asJson(
    await fetch('/api/admin/sync-api', { method: 'POST', headers: adminHeaders(secret) })
  )
}

export async function getDbTable(
  secret: string,
  table: string,
  limit: number,
  offset: number
): Promise<DbTablePage> {
  return asJson(
    await fetch(`/api/db/${table}?limit=${limit}&offset=${offset}`, {
      headers: adminHeaders(secret),
    })
  )
}
