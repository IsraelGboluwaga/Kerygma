import type { ReactNode } from 'react'

/**
 * Shared top bar: logo, a divider, an uppercase subtitle, and an optional slot
 * on the right (links/actions). Mirrors the `.top-bar` look from the old pages.
 */
export default function TopBar({
  subtitle,
  right,
}: {
  subtitle: string
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-4 border-b border-line bg-black px-6 py-3">
      <img
        className="block h-[22px] w-auto"
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
      {right && <div className="ml-auto flex items-center gap-3">{right}</div>}
    </div>
  )
}
