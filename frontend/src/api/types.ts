// Shapes returned by the Hono backend's JSON/SSE endpoints. Kept in sync with
// src/web/router.ts on the server side.

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
