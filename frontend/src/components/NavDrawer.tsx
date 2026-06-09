import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useNav } from '../contexts/NavContext'

/** Slide-in nav drawer with iOS-style swipe-from-left-edge gesture. */
export default function NavDrawer() {
  const { isOpen, open, close } = useNav()
  const drawerRef = useRef<HTMLElement>(null)

  // Keep a ref so touch handlers always read the latest value without re-binding.
  const isOpenRef = useRef(isOpen)
  useEffect(() => { isOpenRef.current = isOpen }, [isOpen])

  // Prevent body scroll while drawer is open.
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Close on Escape key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  // Swipe-from-left-edge to open; swipe-left to close (iOS-style).
  useEffect(() => {
    const EDGE_ZONE = 28  // px from left edge that starts an open-swipe
    const touchStart = { x: 0, y: 0 }
    let swiping = false

    function onTouchStart(e: TouchEvent) {
      touchStart.x = e.touches[0].clientX
      touchStart.y = e.touches[0].clientY
      swiping = (!isOpenRef.current && touchStart.x <= EDGE_ZONE) || isOpenRef.current
    }

    function onTouchMove(e: TouchEvent) {
      if (!swiping || !drawerRef.current) return
      const dx = e.touches[0].clientX - touchStart.x
      const dy = e.touches[0].clientY - touchStart.y
      // Cancel if clearly more vertical than horizontal.
      if (Math.abs(dy) > Math.abs(dx) + 10) { swiping = false; return }
      const drawerW = Math.min(280, window.innerWidth * 0.85)
      if (!isOpenRef.current && dx > 0) {
        const p = Math.min(dx / drawerW, 1)
        drawerRef.current.style.transform = `translateX(${(p - 1) * 100}%)`
      } else if (isOpenRef.current && dx < 0) {
        const cp = Math.min(-dx / drawerW, 1)
        drawerRef.current.style.transform = `translateX(${-cp * 100}%)`
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!swiping) return
      swiping = false
      if (drawerRef.current) drawerRef.current.style.transform = ''
      const dx = e.changedTouches[0].clientX - touchStart.x
      if (!isOpenRef.current && dx > 60) open()
      else if (isOpenRef.current && dx < -60) close()
      // Otherwise CSS snaps back.
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [open, close])

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={[
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 sm:hidden',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={close}
        aria-hidden="true"
      />

      {/* Slide-in drawer */}
      <nav
        ref={drawerRef}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col',
          'bg-surface border-r border-line transition-transform duration-300 sm:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-label="Site navigation"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <img className="h-6 w-auto" src="/assets/cci_logo.svg" alt="" />
          <button
            onClick={close}
            className="p-1 text-xl leading-none text-ink-dim transition-colors hover:text-ink-bright"
            aria-label="Close navigation"
          >
            &times;
          </button>
        </div>

        <ul className="py-2">
          <li>
            <button
              className="w-full px-5 py-3 text-left text-[0.95rem] font-semibold text-accent transition-colors hover:bg-surface-raised"
              onClick={() => { close(); window.open('/', '_blank') }}
            >
              + New conversation
            </button>
          </li>
          <li className="mx-0 my-1 h-px bg-line" />
          <li>
            <Link
              to="/"
              className="block px-5 py-3 text-[0.95rem] text-ink transition-colors hover:bg-surface-raised"
              onClick={close}
            >
              Chat
            </Link>
          </li>
          <li>
            <Link
              to="/transcripts"
              className="block px-5 py-3 text-[0.95rem] text-ink transition-colors hover:bg-surface-raised"
              onClick={close}
            >
              Transcripts
            </Link>
          </li>
        </ul>
      </nav>
    </>
  )
}
