import {afterEach, describe, expect, it, vi} from 'vitest'
import {formatRelativeTime} from '@/lib/formatting'

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats past timestamps relative to now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'))

    expect(formatRelativeTime('2026-06-27T08:00:00.000Z')).toBe('4 hours ago')
  })

  it('falls back to never for missing or invalid timestamps', () => {
    expect(formatRelativeTime(null)).toBe('never')
    expect(formatRelativeTime(undefined)).toBe('never')
    expect(formatRelativeTime('not-a-date')).toBe('never')
  })
})
