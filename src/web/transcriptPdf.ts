import PDFDocument from 'pdfkit'
import type { SermonRow } from '../db/queries.js'
import { config } from '../config.js'
import { formatSermonDate, monthYearSlug, slugify } from './transcriptFormat.js'

// Download filename: theme__title__month-year.pdf (theme falls back to "sermon").
export function transcriptPdfFilename(sermon: SermonRow): string {
  const theme = slugify(sermon.theme ?? 'sermon')
  const title = slugify(sermon.title)
  return `${theme}__${title}__${monthYearSlug(sermon.date)}.pdf`
}

/**
 * Render a sermon transcript to a PDF Buffer with pdfkit (pure JS — no headless
 * browser). Even a two-hour sermon renders in well under a second.
 *
 * The transcript text is already verbatim from the `transcriptions` table; it is
 * rendered as flowing paragraphs under a titled header block.
 */
export function generateTranscriptPdf(sermon: SermonRow, transcript: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    const buffers: Buffer[] = []

    doc.on('data', (b: Buffer) => buffers.push(b))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text(sermon.title, { lineGap: 4 })

    const meta = [
      sermon.speaker ?? undefined,
      formatSermonDate(sermon.date),
      sermon.theme ?? undefined,
    ]
      .filter(Boolean)
      .join('  •  ')
    doc.moveDown(0.3).fontSize(10).font('Helvetica').fillColor('#555').text(meta)
    doc.fillColor('#000')

    doc.moveDown(0.6)
    doc
      .moveTo(doc.x, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#cccccc')
      .stroke()
    doc.moveDown(0.8)

    // ── Body ────────────────────────────────────────────────────────────────
    const paragraphs = transcript
      .split(/\n{2,}|\r\n\r\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    doc.fontSize(11).font('Helvetica')
    if (paragraphs.length === 0) {
      doc.fillColor('#888').text('No transcript text available for this sermon.')
    } else {
      for (const p of paragraphs) {
        doc.text(p, { align: 'left', lineGap: 2 })
        doc.moveDown(0.6)
      }
    }

    // ── Footer note ─────────────────────────────────────────────────────────
    doc
      .moveDown(1)
      .fontSize(8)
      .fillColor('#999')
      .text(`Transcript — ${config.MINISTRY_NAME}`, { align: 'center' })

    doc.end()
  })
}
