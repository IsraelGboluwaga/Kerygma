import PDFDocument from 'pdfkit'
import type { BookRow, BookChapterRow, BookSource } from '../db/queries.js'
import { config } from '../config.js'
import { formatSermonDate, monthYearSlug, slugify } from './transcriptFormat.js'

// Download filename: book__title__month-year.pdf.
export function bookPdfFilename(book: BookRow): string {
  const title = slugify(book.title ?? book.topic)
  return `book__${title}__${monthYearSlug(book.created_at)}.pdf`
}

function parseSources(json: string | null): BookSource[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as BookSource[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Render a generated book draft to a PDF Buffer with pdfkit (pure JS — no
 * headless browser, matching the transcript renderer). Layout: a title page, a
 * table of contents, each chapter (heading + flowing paragraphs), and a closing
 * sources page listing the sermons the draft was grounded in.
 */
export function generateBookPdf(book: BookRow, chapters: BookChapterRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 64 })
    const buffers: Buffer[] = []

    doc.on('data', (b: Buffer) => buffers.push(b))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const title = book.title ?? book.topic
    const sources = parseSources(book.sources)

    // ── Title page ────────────────────────────────────────────────────────────
    doc.moveDown(6)
    doc.fontSize(30).font('Helvetica-Bold').text(title, { align: 'center', lineGap: 6 })
    doc.moveDown(1)
    doc
      .fontSize(13)
      .font('Helvetica-Oblique')
      .fillColor('#555')
      .text(`A study drawn from the sermons of ${config.MINISTRY_NAME}`, { align: 'center' })
    doc.fillColor('#000')

    // ── Table of contents ─────────────────────────────────────────────────────
    if (chapters.length > 0) {
      doc.addPage()
      doc.fontSize(18).font('Helvetica-Bold').text('Contents', { lineGap: 6 })
      doc.moveDown(0.8)
      doc.fontSize(12).font('Helvetica')
      chapters.forEach((ch, i) => {
        doc.text(`${i + 1}.  ${ch.heading}`, { lineGap: 4 })
      })
    }

    // ── Chapters ──────────────────────────────────────────────────────────────
    for (const ch of chapters) {
      doc.addPage()
      doc.fontSize(20).font('Helvetica-Bold').text(`${ch.idx + 1}.  ${ch.heading}`, { lineGap: 4 })
      doc.moveDown(0.8)

      const paragraphs = ch.body
        .split(/\n{2,}|\r\n\r\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)

      doc.fontSize(11.5).font('Helvetica')
      if (paragraphs.length === 0) {
        doc.fillColor('#888').text('(No content for this chapter.)')
        doc.fillColor('#000')
      } else {
        for (const p of paragraphs) {
          doc.text(p, { align: 'left', lineGap: 2 })
          doc.moveDown(0.6)
        }
      }
    }

    // ── Sources ───────────────────────────────────────────────────────────────
    if (sources.length > 0) {
      doc.addPage()
      doc.fontSize(18).font('Helvetica-Bold').text('Sources', { lineGap: 6 })
      doc.moveDown(0.3)
      doc
        .fontSize(10)
        .font('Helvetica-Oblique')
        .fillColor('#555')
        .text('This draft was synthesised from the following sermons:')
      doc.fillColor('#000').moveDown(0.6)
      doc.fontSize(11).font('Helvetica')
      for (const s of sources) {
        const line = [s.title, s.speaker ?? undefined, formatSermonDate(s.date)].filter(Boolean).join(' — ')
        doc.text(`•  ${line}`, { lineGap: 3 })
      }
    }

    // ── Footer note ───────────────────────────────────────────────────────────
    doc
      .moveDown(1.5)
      .fontSize(8)
      .fillColor('#999')
      .text(`Generated book draft — ${config.MINISTRY_NAME}`, { align: 'center' })

    doc.end()
  })
}
