import type { ReactNode } from 'react'
import { useTheme } from './ThemeProvider'

interface TopBarProps {
  subtitle: string
  logoHref?: string
  right?: ReactNode
}

export function TopBar({ subtitle, logoHref, right }: TopBarProps) {
  const { theme, toggle } = useTheme()
  const logo = (
    <img className="top-bar-logo" src="/assets/cci_logo.svg" alt={subtitle} />
  )

  return (
    <div className="top-bar">
      {logoHref ? (
        <a href={logoHref} target="_blank" rel="noopener noreferrer" className="top-bar-logo-link">
          {logo}
        </a>
      ) : logo}
      <div className="top-bar-divider" />
      <span className="subtitle">{subtitle}</span>
      <div className="top-bar-spacer" />
      <button className="theme-toggle-btn" onClick={toggle}>
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      {right}
    </div>
  )
}

interface ChatHeaderProps {
  onNew: () => void
  busy: boolean
}

export function ChatHeader({ onNew, busy }: ChatHeaderProps) {
  const { theme, toggle } = useTheme()

  return (
    <header>
      <div>
        <img className="header-logo" src="/assets/cci_logo.svg" alt="Logo" />
        <div className="header-subtitle">AI Library</div>
      </div>
      <div className="header-right">
        <button className="theme-toggle-btn" onClick={toggle}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          className="new-btn"
          onClick={() => { if (!busy) window.open(window.location.href, '_blank') }}
        >
          New conversation
        </button>
      </div>
    </header>
  )
}
