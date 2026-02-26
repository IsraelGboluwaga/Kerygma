// Retryable HTTP status codes from the Anthropic API
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529])

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 1000 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number }).status
      const isRetryable = status != null && RETRYABLE_STATUSES.has(status)
      if (!isRetryable || i === attempts - 1) throw err
      // Exponential backoff: 1s, 2s, 4s, …
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i))
    }
  }
  // Unreachable — loop always throws or returns
  throw new Error('withRetry: exhausted attempts')
}
