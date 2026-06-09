import type { JobStatus } from '../api/types'

const VALID: JobStatus[] = ['queued', 'running', 'done', 'failed']

export default function Badge({ status }: { status: string }) {
  const s = (VALID as string[]).includes(status) ? status : 'queued'
  return <span className={`badge badge-${s}`}>{status}</span>
}
