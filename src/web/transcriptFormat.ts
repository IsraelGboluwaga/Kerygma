// Formatting helpers shared by the transcripts table, the transcript view, and
// the PDF generator so dates and filenames stay consistent across all three.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// "2021-07-04" -> "4 July 2021". Falls back gracefully for partial/odd dates.
export function formatSermonDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const [, year, month, day] = m
  const name = MONTHS[Number(month) - 1] ?? month
  return `${Number(day)} ${name} ${year}`
}

// A date prefix -> human label: "2023" | "February 2023" | "4 July 2021".
export function humanizeDatePrefix(prefix: string): string {
  if (/^\d{4}$/.test(prefix)) return prefix
  const m = /^(\d{4})-(\d{2})$/.exec(prefix)
  if (m) {
    const name = MONTHS[Number(m[2]) - 1] ?? m[2]
    return `${name} ${m[1]}`
  }
  return formatSermonDate(prefix)
}

// "2021-07-04" -> "july-2021" for use in download filenames.
export function monthYearSlug(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return slugify(iso)
  const [, year, month] = m
  const name = MONTHS[Number(month) - 1] ?? month
  return `${name.toLowerCase()}-${year}`
}

// Lowercase, hyphen-separated, ASCII-only — safe for filenames and URLs.
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  )
}
