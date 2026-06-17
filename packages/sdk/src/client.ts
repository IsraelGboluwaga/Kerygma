import type {
  AdminStatus,
  ChatEvent,
  ChatMessage,
  ChatSource,
  DbTablePage,
  Job,
  StatusData,
  ThemeOption,
  TranscriptSearchParams,
  TranscriptSearchResult,
  TranscriptView,
} from './types.js'

/** Thrown when the Kerygma API responds with a non-2xx status. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface KerygmaClientOptions {
  /**
   * Base URL of the Kerygma server, e.g. `https://kerygma.example.com`.
   * A trailing slash is tolerated.
   */
  baseUrl: string
  /**
   * Admin secret, sent as the `X-Admin-Secret` header on admin/db calls.
   * Required only for the `getAdminStatus`/`getAdminJobs`/`getStatusData`/
   * `syncApi`/`getDbTable` methods.
   */
  adminSecret?: string
  /**
   * Custom `fetch` implementation. Defaults to the global `fetch`
   * (Node 18+ and all modern browsers). Inject one for older runtimes.
   */
  fetch?: typeof fetch
}

/**
 * Typed client for the Kerygma sermon knowledge base HTTP API.
 *
 * All data lives under `/api/*`; the one exception is the transcript PDF
 * download, exposed as a URL helper (`transcriptDownloadUrl`) since it is a
 * direct browser link rather than a JSON endpoint.
 */
export class KerygmaClient {
  private readonly baseUrl: string
  private readonly adminSecret?: string
  private readonly fetchImpl: typeof fetch

  constructor(options: KerygmaClientOptions) {
    if (!options.baseUrl) throw new Error('KerygmaClient: `baseUrl` is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.adminSecret = options.adminSecret
    const f = options.fetch ?? globalThis.fetch
    if (typeof f !== 'function') {
      throw new Error(
        'KerygmaClient: no global `fetch` found — pass `fetch` in the options (Node < 18).'
      )
    }
    // Bind to undefined so a browser's global `fetch` is not called with the
    // client as `this` (which throws "Illegal invocation").
    this.fetchImpl = (input, init) => f(input, init)
  }

  // ── Public, read-only endpoints ───────────────────────────────────────────

  /**
   * Search transcripts. Pass a raw query string (already URL-encoded), or a
   * structured `{ q | month | year | theme | topic | speaker }` object.
   */
  async searchTranscripts(
    params: TranscriptSearchParams | string
  ): Promise<TranscriptSearchResult> {
    const qs = typeof params === 'string' ? params : buildQuery(params)
    return this.getJson<TranscriptSearchResult>(`/api/transcripts/search?${qs}`)
  }

  /** Fetch a single transcript (sermon metadata + segments + verbatim text). */
  async getTranscript(videoId: string): Promise<TranscriptView> {
    return this.getJson<TranscriptView>(
      `/api/transcripts/${encodeURIComponent(videoId)}`
    )
  }

  /** List themes for the structured search filter. */
  async listThemes(): Promise<ThemeOption[]> {
    return this.getJson<ThemeOption[]>('/api/themes')
  }

  /** Build the on-demand PDF download URL for a transcript. */
  transcriptDownloadUrl(videoId: string): string {
    return `${this.baseUrl}/transcripts/${encodeURIComponent(videoId)}/download`
  }

  /**
   * Open the agentic chat SSE stream and yield parsed events. The backend
   * frames each event as `data: {json}\n\n`; `context` (sources) can arrive
   * before the answer text, then `delta` frames stream the answer, ending
   * with `done`.
   */
  async *streamChat(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): AsyncGenerator<ChatEvent> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    })

    if (!res.ok || !res.body) {
      throw await this.errorFromResponse(res, 'Chat request failed')
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

  /**
   * Convenience wrapper over {@link streamChat} that drains the stream and
   * returns the full answer text plus accumulated sources. Throws on an
   * `error` frame.
   */
  async ask(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<{ answer: string; sources: ChatSource[] }> {
    let answer = ''
    let sources: ChatSource[] = []
    for await (const ev of this.streamChat(messages, signal)) {
      if (ev.type === 'delta') answer += ev.text
      else if (ev.type === 'context') sources = ev.sources
      else if (ev.type === 'error') throw new ApiError(ev.message, 500)
    }
    return { answer, sources }
  }

  // ── Admin endpoints (X-Admin-Secret) ──────────────────────────────────────

  async getAdminStatus(): Promise<AdminStatus> {
    return this.getJson<AdminStatus>('/api/admin/status', this.adminHeaders())
  }

  async getAdminJobs(): Promise<Job[]> {
    return this.getJson<Job[]>('/api/admin/jobs', this.adminHeaders())
  }

  async getStatusData(): Promise<StatusData> {
    return this.getJson<StatusData>('/api/admin/status/data', this.adminHeaders())
  }

  /** Trigger a background sync from the upstream sermon REST API. */
  async syncApi(): Promise<{ ok: boolean }> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/admin/sync-api`, {
      method: 'POST',
      headers: this.adminHeaders(),
    })
    if (!res.ok) throw await this.errorFromResponse(res, 'Sync request failed')
    return res.json() as Promise<{ ok: boolean }>
  }

  async getDbTable(
    table: string,
    limit = 50,
    offset = 0
  ): Promise<DbTablePage> {
    return this.getJson<DbTablePage>(
      `/api/db/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`,
      this.adminHeaders()
    )
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private adminHeaders(): Record<string, string> {
    if (!this.adminSecret) {
      throw new Error(
        'KerygmaClient: this method requires `adminSecret` in the client options.'
      )
    }
    return { 'X-Admin-Secret': this.adminSecret }
  }

  private async getJson<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers })
    if (!res.ok) throw await this.errorFromResponse(res, `Request failed (${res.status})`)
    return res.json() as Promise<T>
  }

  private async errorFromResponse(res: Response, fallback: string): Promise<ApiError> {
    let message = `${fallback} (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    return new ApiError(message, res.status)
  }
}

function buildQuery(params: TranscriptSearchParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      qs.set(key, String(value))
    }
  }
  return qs.toString()
}
