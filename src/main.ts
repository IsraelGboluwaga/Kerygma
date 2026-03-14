import http from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import { logger } from './logger.js'
import { initDatabase } from './db/connection.js'
import { loadEmbedder } from './ingestion/embedder.js'
import { createMcpServer } from './mcp/server.js'
import { createRouter } from './web/router.js'
import { waitUntilIdle } from './queue.js'
import { failStaleJobs } from './db/queries.js'

async function main() {
  logger.info('Starting up...')

  // 1. Initialise SQLite
  initDatabase()
  failStaleJobs() // mark any pending/running jobs from previous run as failed
  logger.info(`Database ready at ${config.DB_PATH}`)

  // 2. Build handlers — single Anthropic instance shared across the app
  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  const app = createRouter(anthropic)

  const honoListener = getRequestListener(app.fetch) as (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => Promise<void>

  // 4. Raw Node HTTP server — /mcp bypasses Hono to avoid double-response writes.
  //    A fresh McpServer is created per request to prevent shared transport state
  //    from causing issues under concurrent requests.
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/mcp')) {
      const mcpServer = createMcpServer(anthropic)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — correct for multi-instance deploys
      })
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res)
      return
    }

    await honoListener(req, res)
  })

  // 5. Graceful shutdown — wait for any in-progress ingestion job to finish
  //    before exiting so temp files are cleaned up and DB writes complete.
  const shutdown = async (signal: string) => {
    logger.warn(`${signal} received — waiting for active job to finish...`)
    server.close()
    await waitUntilIdle()
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  server.listen(config.PORT, () => {
    logger.info(`Listening on http://localhost:${config.PORT}`)
    logger.info(`Admin UI:     http://localhost:${config.PORT}/admin`)
    logger.info(`MCP endpoint: http://localhost:${config.PORT}/mcp`)
  })

  // 3. Warm up embedding model in background — server is already accepting requests.
  //    Ingestion jobs that need the embedder will await it naturally via getEmbedder().
  logger.info('Loading embedder...')
  loadEmbedder()
    .then(() => logger.info('Embedder ready'))
    .catch((err) => logger.error('Failed to load embedder', err))
}

main().catch((err) => {
  logger.error('Fatal startup error', err)
  process.exit(1)
})
