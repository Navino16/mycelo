/**
 * Dotted keys, exactly as the core's catalog.ts flattens them: a catalogue key is a
 * single opaque string everywhere else, so the kit and the runtime must agree on what
 * one is. Returns the first non-string key found, or null.
 */
function flatten(node: unknown, prefix: string, out: Map<string, string>): string | null {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return null
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return prefix
  for (const [name, child] of Object.entries(node)) {
    const bad = flatten(child, prefix === '' ? name : `${prefix}.${name}`, out)
    if (bad !== null) return bad
  }
  return null
}

export interface FlatCatalog {
  locale: string
  /** Empty when `badKey` is set: a catalogue with a non-string leaf is not read further. */
  messages: Map<string, string>
  badKey?: string
}

/**
 * One entry per supplied locale, in the order the harness declared them. Shared by the catalogue
 * compilation check and the config-refusal key check so the two cannot disagree about what a key is.
 */
export function flattenCatalogs(catalogs: Record<string, unknown>): readonly FlatCatalog[] {
  const out: FlatCatalog[] = []
  for (const [locale, raw] of Object.entries(catalogs)) {
    // An empty or comment-only file parses to null: catalog.ts treats that as a catalogue with no
    // keys, not a fault, and the kit must agree.
    if (raw === null || raw === undefined) continue
    const messages = new Map<string, string>()
    const badKey = flatten(raw, '', messages)
    out.push(badKey === null ? { locale, messages } : { locale, messages: new Map(), badKey })
  }
  return out
}

/** Every key any supplied catalogue declares. A partial contribution is fine (design §7.2). */
export function declaredCatalogKeys(catalogs: Record<string, unknown> | undefined): ReadonlySet<string> {
  const keys = new Set<string>()
  if (catalogs === undefined) return keys
  for (const flat of flattenCatalogs(catalogs)) for (const key of flat.messages.keys()) keys.add(key)
  return keys
}
