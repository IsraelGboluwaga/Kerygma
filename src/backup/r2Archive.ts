import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import cron from 'node-cron'
import { config } from '../config.js'
import { getDb } from '../db/connection.js'
import { logger } from '../logger.js'
import { errMsg } from '../utils.js'

type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

const ARCHIVE_PREFIX = 'archives'
const ARCHIVE_CRON = '15 3 * * *'
let archiveInProgress = false

function getR2Config(): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = config
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return null
  }

  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  }
}

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
}

function hmac(key: crypto.BinaryLike | crypto.KeyObject, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value).digest()
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function putObject(r2: R2Config, key: string, filePath: string): Promise<void> {
  const stat = await fs.promises.stat(filePath)
  const payloadHash = await hashFile(filePath)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const host = `${r2.accountId}.r2.cloudflarestorage.com`
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const canonicalUri = `/${encodeURIComponent(r2.bucket)}/${encodedKey}`
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n')
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')
  const dateKey = hmac(`AWS4${r2.secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, 'auto')
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: 'PUT',
        hostname: host,
        path: canonicalUri,
        headers: {
          Authorization: authorization,
          'Content-Length': stat.size,
          'Content-Type': 'application/vnd.sqlite3',
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
        },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve()
            return
          }

          reject(new Error(`R2 archive upload failed (${res.statusCode ?? 'unknown'}): ${body}`))
        })
      }
    )

    req.on('error', reject)
    fs.createReadStream(filePath).on('error', reject).pipe(req)
  })
}

export async function archiveDatabaseToR2(): Promise<void> {
  const r2 = getR2Config()
  if (!r2) return
  if (archiveInProgress) {
    logger.warn('R2 archive skipped — previous archive still running')
    return
  }

  const timestamp = timestampForFilename()
  const objectKey = `${ARCHIVE_PREFIX}/sermons-${timestamp}.db`
  const tempPath = path.join(path.dirname(path.resolve(config.DB_PATH)), `.sermons-archive-${timestamp}.db`)

  try {
    archiveInProgress = true
    logger.info(`R2 archive: creating ${objectKey}`)
    await getDb().backup(tempPath)
    await putObject(r2, objectKey, tempPath)
    logger.info(`R2 archive complete: ${objectKey}`)
  } catch (err) {
    logger.error(`R2 archive failed: ${errMsg(err)}`)
  } finally {
    archiveInProgress = false
    await fs.promises.rm(tempPath, { force: true })
  }
}

export function startR2ArchiveScheduler(): void {
  if (!getR2Config()) {
    return
  }

  void archiveDatabaseToR2()
  cron.schedule(ARCHIVE_CRON, () => {
    void archiveDatabaseToR2()
  }, { timezone: 'Etc/UTC' })
  logger.info('R2 archive scheduler started — daily at 03:15 UTC')
}
