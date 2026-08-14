import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { IntlMessageFormat } from 'intl-messageformat'
import { parse as parseYaml } from 'yaml'

/** A locale's compiled messages, keyed by dotted catalogue key. */
export type Messages = ReadonlyMap<string, IntlMessageFormat>
/** One domain's catalogues: canonical locale tag → messages. */
export type LocaleMessages = ReadonlyMap<string, Messages>
/** Every domain: domain name → its catalogues. */
export type Catalogs = ReadonlyMap<string, LocaleMessages>

export class CatalogError extends Error {
  readonly file: string
  /** The offending key, or null when the fault is the file itself. */
  readonly key: string | null
  constructor(message: string, file: string, key: string | null = null) {
    super(`${file}: ${message}`)
    this.name = 'CatalogError'
    this.file = file
    this.key = key
  }
}

function canonical(tag: string, file: string): string {
  try {
    const [only] = Intl.getCanonicalLocales(tag)
    if (only === undefined) throw new RangeError(`empty locale tag`)
    return only
  } catch (e) {
    throw new CatalogError(`'${tag}' is not a locale tag: ${(e as Error).message}`, file)
  }
}

// Dotted keys rather than a nested lookup: a catalogue key is a single opaque string
// everywhere else (ctx.t('error.timeout')), so the nesting is a convenience of the file
// format, not part of the data model.
function flatten(node: unknown, prefix: string, out: Map<string, string>, file: string): void {
  if (typeof node === 'string') {
    out.set(prefix, node)
    return
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new CatalogError(`key '${prefix}' is not a string`, file, prefix)
  }
  for (const [name, child] of Object.entries(node)) {
    flatten(child, prefix === '' ? name : `${prefix}.${name}`, out, file)
  }
}

function compile(source: ReadonlyMap<string, string>, locale: string, file: string): Messages {
  const compiled = new Map<string, IntlMessageFormat>()
  for (const [key, message] of source) {
    try {
      compiled.set(key, new IntlMessageFormat(message, locale))
    } catch (e) {
      throw new CatalogError(`key '${key}' does not compile: ${(e as Error).message}`, file, key)
    }
  }
  return compiled
}

/**
 * Every `<locale>.yaml` in one domain's translations directory, compiled. Throws
 * CatalogError on the first fault, which germination turns into dormancy (design §7.1).
 */
export function loadCatalogs(dir: string): LocaleMessages {
  if (!existsSync(dir)) return new Map()
  const byLocale = new Map<string, Messages>()
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.yaml'))
    .map((e) => e.name)
    .sort()
  for (const name of files) {
    const file = join(dir, name)
    const locale = canonical(name.slice(0, -'.yaml'.length), file)
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(file, 'utf8'))
    } catch (e) {
      throw new CatalogError(`cannot read: ${(e as Error).message}`, file)
    }
    const flat = new Map<string, string>()
    // An empty file parses to null, which is a catalogue with no keys, not a fault.
    if (raw !== null && raw !== undefined) flatten(raw, '', flat, file)
    byLocale.set(locale, compile(flat, locale, file))
  }
  return byLocale
}
