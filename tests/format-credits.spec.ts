/**
 * Credit amounts read the same everywhere: whole numbers stay whole, a
 * fractional balance keeps two decimals, thousands are grouped.
 */
import { describe, expect, it } from 'vitest'
import { formatCredits } from '../src/client/copy.ts'

describe('formatCredits', () => {
  it('drops the .00 of a whole number', () => {
    expect(formatCredits(12345)).toBe('12,345')
    expect(formatCredits(0)).toBe('0')
  })

  it('keeps exactly two decimals when fractional', () => {
    expect(formatCredits(12345.7)).toBe('12,345.70')
    expect(formatCredits(12345.67)).toBe('12,345.67')
  })

  it('rounds to two decimals', () => {
    expect(formatCredits(1.239)).toBe('1.24')
  })

  it('answers a dash for a non-finite figure', () => {
    expect(formatCredits(Number.NaN)).toBe('—')
    expect(formatCredits(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
