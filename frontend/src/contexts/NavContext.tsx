import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface NavCtx {
  isOpen: boolean
  open: () => void
  close: () => void
}

const NavContext = createContext<NavCtx>({ isOpen: false, open: () => {}, close: () => {} })

export function useNav(): NavCtx {
  return useContext(NavContext)
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return <NavContext.Provider value={{ isOpen, open, close }}>{children}</NavContext.Provider>
}
