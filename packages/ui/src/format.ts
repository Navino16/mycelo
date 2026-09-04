export interface UptimeUnits { d: string, h: string, m: string, s: string }

const PAD = (n: number): string => String(n).padStart(2, '0')

/** Two units at most (design's `14d 03h`); the second is padded so a monospace foot never reflows. */
export function formatUptime(seconds: number, units: UptimeUnits): string {
  const whole = Math.max(0, Math.floor(seconds))
  const d = Math.floor(whole / 86_400)
  const h = Math.floor((whole % 86_400) / 3_600)
  const m = Math.floor((whole % 3_600) / 60)
  const s = whole % 60
  if (d > 0) return `${String(d)}${units.d} ${PAD(h)}${units.h}`
  if (h > 0) return `${String(h)}${units.h} ${PAD(m)}${units.m}`
  if (m > 0) return `${String(m)}${units.m} ${PAD(s)}${units.s}`
  return `${String(s)}${units.s}`
}
