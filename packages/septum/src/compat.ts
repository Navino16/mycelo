import { parseRange, satisfies } from './semver.js'
import { SEPTUM_VERSION } from './version.js'

/**
 * False for a range that admits every version and for one that cannot be parsed at all — both
 * would make the compatibility check silently inert for that spore (design §10.1). The two
 * probes catch the wildcard forms (`*`, `x`, an empty range); the parse catches the rest.
 */
export function isParseableRange(range: string): boolean {
  if (parseRange(range) === null) return false
  return !(satisfies('0.0.1', range) && satisfies('99999.0.0', range))
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
  if (satisfies(septumVersion, range)) return undefined
  return `declares septum '${range}', which excludes the septum actually running (${septumVersion})`
}
