type Triple = readonly [number, number, number]

/** A prerelease or build suffix is ignored: the triple is what orders two strains here. */
function triple(strain: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(strain.trim())
  if (m === null) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * Part-by-part numeric compare, because `'1.10.0' < '1.9.0'` as strings. An unparseable
 * strain on either side answers false: claiming an update that does not exist is worse
 * than showing none.
 */
export function isNewerStrain(offer: string, installed: string): boolean {
  const a = triple(offer)
  const b = triple(installed)
  if (a === null || b === null) return false
  for (let i = 0; i < 3; i += 1) {
    const [x, y] = [a[i], b[i]]
    if (x !== y) return (x ?? 0) > (y ?? 0)
  }
  return false
}
