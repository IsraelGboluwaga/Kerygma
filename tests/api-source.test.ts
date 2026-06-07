import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

import { fetchAllSermons } from '../src/ingestion/api-source.js'

function makeApiResponse(
  sermons: object[],
  total = sermons.length,
  page = 1,
  perPage = 50
) {
  return {
    success: true,
    data: { total, page, perPage, data: sermons },
  }
}

function mockOkResponse(body: object) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const baseSermon = {
  _id: 'sermon-id-001',
  title: 'Walking by Faith',
  preacher: 'Pastor Johnson',
  sermon_date: '2024-03-10T00:00:00.000Z',
  audio_info: { audio_url: '/audio/walking-by-faith.mp3' },
  theme: { _id: 'theme-1', name: 'Faith Series', slug: 'faith-series' },
  tags: ['faith', 'grace'],
  description_string: 'A sermon on walking in faith.',
  excerpt: 'A short take on walking by faith.',
  slug: 'walking-by-faith',
}

describe('fetchAllSermons', () => {
  it('yields a mapped IngestRequest for each sermon', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([baseSermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect(results).toHaveLength(1)
    const req = results[0] as Record<string, unknown>
    expect(req.videoId).toBe('sermon-id-001')
    expect(req.title).toBe('Walking by Faith')
    expect(req.speaker).toBe('Pastor Johnson')
    expect(req.date).toBe('2024-03-10')
    expect(req.theme).toEqual({ themeId: 'theme-1', name: 'Faith Series', slug: 'faith-series' })
    expect(req.excerpt).toBe('A short take on walking by faith.')
    expect(req.tags).toEqual(['faith', 'grace'])
    expect(req.description).toBe('A sermon on walking in faith.')
  })

  it('builds downloadUrl by prepending AUDIO_BASE_URL to a relative audio path (no doubled slash)', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([baseSermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    const req = results[0] as Record<string, string>
    expect(req.downloadUrl).toBe(
      'https://sermons-api.test.example.com/audio/walking-by-faith.mp3'
    )
  })

  it('requests the listing endpoint without duplicating the /sermons path', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([baseSermon])))

    for await (const _ of fetchAllSermons()) { /* drain */ }

    expect(mockFetch).toHaveBeenCalledWith(
      'https://sermons-api.test.example.com/sermons?search=&page=1&perPage=50',
      expect.anything()
    )
  })

  it('passes through absolute audio URLs unchanged', async () => {
    const sermon = { ...baseSermon, audio_info: { audio_url: 'https://cdn.example.com/sermon.mp3' } }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, string>).downloadUrl).toBe(
      'https://cdn.example.com/sermon.mp3'
    )
  })

  it('paginates through all pages', async () => {
    // 51 total items means 2 pages: page 1 = 50 items, page 2 = 1 item
    const page1Sermons = Array.from({ length: 50 }, (_, i) => ({
      ...baseSermon,
      _id: `id-p1-${i}`,
      title: `Sermon P1-${i}`,
    }))
    const page2Sermons = [{ ...baseSermon, _id: 'id-p2-0', title: 'Sermon P2-0' }]

    mockFetch
      .mockResolvedValueOnce(mockOkResponse({ success: true, data: { total: 51, page: 1, perPage: 50, data: page1Sermons } }))
      .mockResolvedValueOnce(mockOkResponse({ success: true, data: { total: 51, page: 2, perPage: 50, data: page2Sermons } }))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect(results).toHaveLength(51)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops when the API returns an empty data array before reaching total', async () => {
    mockFetch
      .mockResolvedValueOnce(mockOkResponse(makeApiResponse([baseSermon], 10, 1, 50)))
      .mockResolvedValueOnce(mockOkResponse(makeApiResponse([], 10, 2, 50)))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect(results).toHaveLength(1)
  })

  it('throws when the API returns a non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' })

    await expect(async () => {
      for await (const _ of fetchAllSermons()) { /* drain */ }
    }).rejects.toThrow('503')
  })

  it('throws when the API response has unexpected shape', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: false }) })

    await expect(async () => {
      for await (const _ of fetchAllSermons()) { /* drain */ }
    }).rejects.toThrow('Unexpected API response format')
  })

  it('handles tag arrays that contain objects with a name field', async () => {
    const sermon = {
      ...baseSermon,
      tags: [{ _id: 'tag-1', name: 'prayer' }, { _id: 'tag-2', name: 'healing' }],
    }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, string[]>).tags).toEqual(['prayer', 'healing'])
  })

  it('omits theme when theme is null', async () => {
    const sermon = { ...baseSermon, theme: null }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, unknown>).theme).toBeUndefined()
  })

  it('omits theme when the upstream theme has no _id', async () => {
    const sermon = { ...baseSermon, theme: { name: 'No Id Theme' } }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, unknown>).theme).toBeUndefined()
  })

  it('omits description when description_string is empty', async () => {
    const sermon = { ...baseSermon, description_string: '' }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, unknown>).description).toBeUndefined()
  })

  it('extracts only YYYY-MM-DD from ISO date string', async () => {
    const sermon = { ...baseSermon, sermon_date: '2024-12-25T14:30:00.000Z' }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, string>).date).toBe('2024-12-25')
  })

  it('maps youtube_link to webpageUrl', async () => {
    const sermon = { ...baseSermon, youtube_link: 'https://youtube.com/watch?v=abc123' }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, string>).webpageUrl).toBe('https://youtube.com/watch?v=abc123')
  })

  it('omits webpageUrl when youtube_link is null', async () => {
    const sermon = { ...baseSermon, youtube_link: null }
    mockFetch.mockResolvedValue(mockOkResponse(makeApiResponse([sermon])))

    const results: object[] = []
    for await (const req of fetchAllSermons()) results.push(req)

    expect((results[0] as Record<string, unknown>).webpageUrl).toBeUndefined()
  })
})
