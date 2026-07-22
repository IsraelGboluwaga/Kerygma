import { useEffect, useRef } from 'react'

// Runs `callback` (optionally immediately) and then every `ms` milliseconds
// while `enabled` is true, tearing the interval down on cleanup. Extracted
// from the near-identical setInterval/clearInterval boilerplate repeated
// across the admin pages (AdminPage, LiveStatusPage, DbBrowserPage).
export function useInterval(callback: () => void, ms: number, enabled = true, immediate = true): void {
  const savedCallback = useRef(callback)
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    if (immediate) savedCallback.current()
    const id = setInterval(() => savedCallback.current(), ms)
    return () => clearInterval(id)
  }, [ms, enabled, immediate])
}
