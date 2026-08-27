import { parseRange, satisfies } from './semver.js'
import { SEPTUM_VERSION } from './version.js'

/**
 * Why a range cannot serve as a `septum:` bound, or undefined when it can. Two causes, kept
 * distinct because they need different sentences: one is a range the matcher cannot read, the
 * other is a readable range that the compatibility check could not learn anything from.
 */
export function rangeRejection(range: string): string | undefined {
  if (parseRange(range) === null) return 'is not a range this matcher can parse'
  // A probe, not a universality test (design §10.1): a range admitting versions this far apart
  // cannot distinguish one septum from another, whatever it excludes in between.
  // No trailing inference: a bounded union bracketing both probes (`<0.5 || >=2`) is refused here
  // and would also have been excluded by the version check, so "nothing to check" is false of it.
  if (satisfies('0.0.1', range) && satisfies('99999.0.0', range)) {
    return 'admits both 0.0.1 and 99999.0.0'
  }
  return undefined
}

/** False for a range the matcher cannot read, and for one the probe above cannot learn from. */
export function isParseableRange(range: string): boolean {
  return rangeRejection(range) === undefined
}

/**
 * Undefined when the range admits the septum actually running; a sentence naming both when it
 * does not. One implementation for the conformance kit and for the core: two would drift at
 * exactly the septum release where the check matters (design §10).
 */
export function septumIncompatibility(range: string, septumVersion: string = SEPTUM_VERSION): string | undefined {
  const rejection = rangeRejection(range)
  if (rejection !== undefined) return `declares septum '${range}', which ${rejection}`
  if (satisfies(septumVersion, range)) return undefined
  return `declares septum '${range}', which excludes the septum actually running (${septumVersion})`
}
