import { useState, useCallback } from 'react'

const KEY = 'adminSecret'

/**
 * Admin secret kept in sessionStorage so it persists across the admin pages for
 * the tab's lifetime but is not written to disk — same model as the original UI.
 */
export function useAdminSecret(): [string, (next: string) => void] {
  const [secret, setSecret] = useState<string>(
    () => sessionStorage.getItem(KEY) ?? ''
  )

  const update = useCallback((next: string) => {
    setSecret(next)
    if (next) sessionStorage.setItem(KEY, next)
    else sessionStorage.removeItem(KEY)
  }, [])

  return [secret, update]
}
