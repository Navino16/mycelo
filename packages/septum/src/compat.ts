import { SEPTUM_VERSION } from './version.js'

// Bun.semver exposes no range validator, so parseability is established by use: an unparseable
// range matches every version (design §10.1), and a real range cannot admit two versions this
// far apart. Measured on Bun 1.4.0.
export function isParseableRange(range: string): boolean {
  return !(Bun.semver.satisfies('0.0.1', range) && Bun.semver.satisfies('99999.0.0', range))
}

/**
 * Undefined when the range admits the septum actually running; a sentence naming both when it
 * does not. One implementation for the conformance kit and for the core: two would drift at
 * exactly the septum release where the check matters (design §10).
 */
export function septumIncompatibility(range: string, septumVersion: string = SEPTUM_VERSION): string | undefined {
  if (!isParseableRange(range)) {
    return `declares septum '${range}', which is not a semver range: an unparseable range would admit every version, including ${septumVersion}`
  }
  if (Bun.semver.satisfies(septumVersion, range)) return undefined
  return `declares septum '${range}', which excludes the septum actually running (${septumVersion})`
}
