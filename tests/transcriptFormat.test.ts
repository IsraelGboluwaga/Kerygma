import { describe, it, expect } from 'vitest'
import {
  formatSermonDate,
  monthYearSlug,
  humanizeDatePrefix,
  slugify,
} from '../src/web/transcriptFormat.js'

describe('formatSermonDate', () => {
  it('formats a full ISO date', () => {
    expect(formatSermonDate('2021-07-04')).toBe('4 July 2021')
    expect(formatSermonDate('2023-02-15')).toBe('15 February 2023')
  })

  it('passes through unrecognised input', () => {
    expect(formatSermonDate('2021-07')).toBe('2021-07')
    expect(formatSermonDate('not-a-date')).toBe('not-a-date')
  })
})

describe('monthYearSlug', () => {
  it('produces month-year for filenames', () => {
    expect(monthYearSlug('2021-07-04')).toBe('july-2021')
    expect(monthYearSlug('2023-12-25')).toBe('december-2023')
  })
})

describe('humanizeDatePrefix', () => {
  it('handles year, month, and day prefixes', () => {
    expect(humanizeDatePrefix('2023')).toBe('2023')
    expect(humanizeDatePrefix('2023-02')).toBe('February 2023')
    expect(humanizeDatePrefix('2021-07-04')).toBe('4 July 2021')
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Walking By Faith!')).toBe('walking-by-faith')
    expect(slugify('  Grace & Truth  ')).toBe('grace-truth')
  })

  it('falls back to "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('!!!')).toBe('untitled')
  })
})
