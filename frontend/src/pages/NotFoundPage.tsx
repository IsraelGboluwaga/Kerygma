import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-semibold text-white">404</h1>
      <p className="text-ink-dim">This page doesn’t exist.</p>
      <Link to="/" className="btn-ghost">
        Go to chat
      </Link>
    </div>
  )
}
