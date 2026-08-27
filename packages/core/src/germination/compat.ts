import { SEPTUM_VERSION } from '@mycelo/septum'

// The same two probes as septum's manifest guard: Bun.semver exposes no range validator, and
// an unparseable range matches every version (design §10.1). A spore installed by an older
// core never went through that guard, so the case is reachable here.
function isParseableRange(range: string): boolean {
  return !(Bun.semver.satisfies('0.0.1', range) && Bun.semver.satisfies('99999.0.0', range))
}

/** Undefined when the range admits the running septum; a sentence naming both when it does not. */
export function septumIncompatibility(range: string, septumVersion: string = SEPTUM_VERSION): string | undefined {
  if (!isParseableRange(range)) {
    return `declares septum '${range}', which is not a semver range: an unparseable range would admit every version, including ${septumVersion}`
  }
  if (Bun.semver.satisfies(septumVersion, range)) return undefined
  return `declares septum '${range}', which excludes the septum this core runs (${septumVersion})`
}
