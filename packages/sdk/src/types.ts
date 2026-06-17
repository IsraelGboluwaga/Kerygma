// Shapes returned by the Kerygma Hono backend's JSON/SSE endpoints.
// Kept in sync with `src/web/router.ts` on the server side (and mirrored from
// `frontend/src/api/types.ts`). These are two hand-maintained copies of the
// same contract — update both when a route's response shape changes.

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSource {
  title: string
  date: string
  timestamp?: string
}

/** SSE event frames emitted by POST /api/chat. */
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'context'; sources: ChatSource[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface TranscriptRow {
  videoId: string
  title: string
  date: string
  dateFormatted: string
  theme: string | null
  excerpt: string | null
  speaker: string | null
  hasTranscript: boolean
  viewUrl: string
  downloadUrl: string
}

export interface TranscriptSearchResult {
  interpreted: string
  sermons: TranscriptRow[]
}

export interface TranscriptSegment {
  text: string
  start: number
  duration: number
}

export interface TranscriptView {
  sermon: {
    videoId: string
    title: string
    date: string
    dateFormatted: string
    speaker: string | null
    theme: string | null
  }
  segments: TranscriptSegment[]
  transcript: string
  hasTranscript: boolean
}

export interface ThemeOption {
  id: number
  name: string
}

export interface AdminStatus {
  queueDepth: number
  lastSyncAt: string | null
  sermonCount: number
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface Job {
  id: string
  title?: string
  status: JobStatus
  phase?: string
  message?: string
  error?: string
  position?: number
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export interface StatusData {
  queueDepth: number
  jobs: Job[]
}

export interface DbTablePage {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
}

/** Structured filters for GET /api/transcripts/search. */
export interface TranscriptSearchParams {
  /** Natural-language query (parsed server-side via `parseTranscriptQuery`). */
  q?: string
  month?: string | number
  year?: string | number
  /** Theme id or name. */
  theme?: string | number
  /** A subject the sermon is *about* (relevance search), e.g. "faith". */
  topic?: string
  speaker?: string
}
