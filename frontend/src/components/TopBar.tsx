import type { ReactNode } from 'react'
import ThemeToggle from './ThemeToggle'
import { useNav } from '../contexts/NavContext'

function HamburgerIcon() {
  return (
    <svg
      width="20" height="20" viewBox="0 0 20 20"
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2.5" y1="5" x2="17.5" y2="5" />
      <line x1="2.5" y1="10" x2="17.5" y2="10" />
      <line x1="2.5" y1="15" x2="17.5" y2="15" />
    </svg>
  )
}

/**
 * Shared top bar: logo, divider, subtitle, optional right slot (hidden on
 * mobile), theme toggle (always), and hamburger (mobile only).
 */
export default function TopBar({
  subtitle,
  right,
}: {
  subtitle: string
  right?: ReactNode
}) {
  const { open } = useNav()

  return (
    <div className="relative flex items-center border-b border-line bg-bg px-6 py-3">
      {/* Logo + subtitle — left-aligned on mobile; absolutely centered on sm+ so it stays mid-page regardless of right-side controls */}
      <div className="flex justify-center sm:pointer-events-none sm:absolute sm:inset-x-0">
        <div className="flex items-center gap-4">
          <img
            className="block h-[22px] w-auto logo-inv"
            src="/assets/cci_logo.svg"
            alt="logo"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <div className="h-5 w-px bg-line-strong" />
          <div className="text-[0.78rem] uppercase tracking-[0.04em] text-ink-faint">
            {subtitle}
          </div>
        </div>
      </div>

      {/* Right-side controls — in normal flow, pushed to the right */}
      <div className="ml-auto flex items-center gap-2">
        {/* Desktop right slot — hidden on mobile */}
        {right && (
          <div className="hidden items-center gap-3 sm:flex">{right}</div>
        )}

        <ThemeToggle />

        {/* Hamburger — mobile only */}
        <button
          className="flex items-center justify-center rounded-md border border-line-strong p-1.5 text-ink-dim transition-colors hover:border-accent hover:text-ink-bright sm:hidden"
          aria-label="Open navigation menu"
          onClick={open}
        >
          <HamburgerIcon />
        </button>
      </div>
    </div>
  )
}
