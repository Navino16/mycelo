import { describe, expect, it } from 'bun:test'
import { formatUptime } from '../src/format.ts'

const EN = { d: 'd', h: 'h', m: 'm', s: 's' }

describe('formatUptime', () => {
  it('renders days and zero-padded hours, as 1a-overview-desktop-degraded.png shows', () => {
    expect(formatUptime(14 * 86_400 + 3 * 3_600, EN)).toBe('14d 03h')
  })

  it('renders hours and zero-padded minutes below a day', () => {
    expect(formatUptime(5 * 3_600 + 8 * 60, EN)).toBe('5h 08m')
  })

  it('renders minutes and zero-padded seconds below an hour', () => {
    expect(formatUptime(18 * 60 + 4, EN)).toBe('18m 04s')
  })

  it('renders seconds alone below a minute', () => {
    expect(formatUptime(41, EN)).toBe('41s')
  })

  // Two units, never three: a three-unit format is what makes the sidebar foot reflow.
  it('drops the third unit rather than showing it', () => {
    expect(formatUptime(14 * 86_400 + 3 * 3_600 + 59 * 60 + 59, EN)).toBe('14d 03h')
  })

  it("uses the locale's own unit letters", () => {
    expect(formatUptime(2 * 86_400, { d: 'j', h: 'h', m: 'min', s: 's' })).toBe('2j 00h')
  })

  it('answers 0s rather than an empty string for a substrate that just booted', () => {
    expect(formatUptime(0, EN)).toBe('0s')
  })

  // Clock skew, not a malformed payload: a non-finite uptime is refused by useUptimeLine,
  // which renders nothing rather than letting this function invent a plausible '0s'.
  it('clamps a negative uptime rather than counting backwards', () => {
    expect(formatUptime(-5, EN)).toBe('0s')
  })
})
