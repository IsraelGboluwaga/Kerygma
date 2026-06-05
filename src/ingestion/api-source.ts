import { config } from '../config.js'
import { logger } from '../logger.js'
import type { IngestRequest } from './pipeline.js'

interface ApiTag {
  _id?: string
  name?: string
}

interface ApiTheme {
  _id?: string
  name?: string
}

interface ApiAudioInfo {
  audio_url: string
}

interface ApiSermon {
  _id: string
  title: string
  preacher: string
  sermon_date: string       // ISO 8601 date string
  audio_info: ApiAudioInfo
  theme?: ApiTheme | null
  tags?: string[] | ApiTag[]
  description_string?: string
  slug?: string
}

interface ApiPage {
  success: boolean
  data: {
    total: number
    page: number
    perPage: number
    data: ApiSermon[]
  }
}

function normalizeTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags) || tags.length === 0) return undefined
  return (tags as Array<string | ApiTag>).map((t) => {
    if (typeof t === 'string') return t
    if (t && typeof t === 'object' && 'name' in t) return String(t.name ?? '')
    return ''
  }).filter(Boolean)
}

function mapToIngestRequest(sermon: ApiSermon): IngestRequest {
  const audioPath = sermon.audio_info?.audio_url ?? ''
  const downloadUrl = audioPath.startsWith('http')
    ? audioPath
    : `${config.SERMON_BASE_URL}${audioPath}`

  return {
    videoId: sermon._id,
    downloadUrl,
    title: sermon.title,
    speaker: sermon.preacher,
    date: sermon.sermon_date.slice(0, 10),  // YYYY-MM-DD
    series: sermon.theme?.name,
    tags: normalizeTags(sermon.tags),
    description: sermon.description_string || undefined,
  }
}

export async function* fetchAllSermons(): AsyncGenerator<IngestRequest> {
  const baseUrl = config.SERMON_BASE_URL
  let page = 1
  const perPage = 50
  let total: number | null = null

  while (true) {
    const url = `${baseUrl}/sermons?search=&page=${page}&perPage=${perPage}`
    logger.info(`Fetching sermon list page ${page}...`)

    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      throw new Error(`Sermon API ${response.status}: ${response.statusText}`)
    }

    const json = (await response.json()) as ApiPage
    if (!json.success || !json.data?.data) {
      throw new Error(`Unexpected API response format on page ${page}`)
    }

    const { data: sermons, total: apiTotal } = json.data
    if (total === null) total = apiTotal

    if (sermons.length === 0) break

    for (const sermon of sermons) {
      yield mapToIngestRequest(sermon)
    }

    if (page * perPage >= total) break
    page++
  }
}
