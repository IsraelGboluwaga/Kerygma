import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

export interface DownloadResult {
  filePath: string
  cleanup: () => void
}

export async function downloadMp3(url: string): Promise<DownloadResult> {
  const tmpFile = path.join(os.tmpdir(), `kerygma-${Date.now()}.mp3`)

  // 5-minute timeout — large sermon files can be slow but shouldn't hang forever
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) })
  if (!response.ok) {
    throw new Error(`Failed to download MP3: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Response body is empty')
  }

  const dest = fs.createWriteStream(tmpFile)
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), dest)

  const cleanup = () => {
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      // already gone — fine
    }
  }

  return { filePath: tmpFile, cleanup }
}
