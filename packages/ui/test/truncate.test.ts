import { describe, expect, it } from 'bun:test'
import { truncateTail } from '../src/truncate.ts'

describe('truncateTail', () => {
  it('keeps the tail, where a path differs', () => {
    expect(truncateTail('/home/u/mycelo/design-9.75', 14)).toBe('…o/design-9.75')
  })

  it('leaves a short label alone', () => {
    expect(truncateTail('sporangium/core', 40)).toBe('sporangium/core')
  })
})
