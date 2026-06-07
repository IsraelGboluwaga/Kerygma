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
  slug?: string
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
  excerpt?: string
  youtube_link?: string | null
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

// Join a base URL and a path with exactly one slash between them, regardless of
// whether the base has a trailing slash or the path a leading one. Prevents both
// the doubled `//` (base + leading-slash path) and missing-slash footguns.
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
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
    : joinUrl(config.AUDIO_BASE_URL, audioPath)

  // Only build a theme when the upstream record carries both a stable id and a
  // name — theme_id is the key we rely on to survive future name changes.
  const theme =
    sermon.theme?._id && sermon.theme?.name
      ? { themeId: sermon.theme._id, name: sermon.theme.name, slug: sermon.theme.slug }
      : undefined

  return {
    videoId: sermon._id,
    downloadUrl,
    webpageUrl: sermon.youtube_link || undefined,
    title: sermon.title,
    speaker: sermon.preacher,
    date: sermon.sermon_date.slice(0, 10),  // YYYY-MM-DD
    excerpt: sermon.excerpt || undefined,
    theme,
    tags: normalizeTags(sermon.tags),
    description: sermon.description_string || undefined,
  }
}

export async function* fetchAllSermons(): AsyncGenerator<IngestRequest> {
  // SERMON_BASE_URL is the full listing endpoint (e.g. https://host/sermons);
  // strip any trailing slash so the query string attaches cleanly.
  const baseUrl = config.SERMON_BASE_URL.replace(/\/+$/, '')
  let page = 1
  const perPage = 50
  let total: number | null = null

  while (true) {
    const url = `${baseUrl}?search=&page=${page}&perPage=${perPage}`
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
