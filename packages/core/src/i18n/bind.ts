import type { Translate, TranslatableRef } from '@mycelo/septum'
import { CORE_DOMAIN, SHARED_DOMAIN } from './core-catalogs.js'
import { resolveParams } from './refusal.js'
import type { Translator } from './translator.js'

export function bindTranslate(options: {
  translator: Translator
  domain: string
  allowed: ReadonlySet<string>
  localeOf: () => string
}): Translate {
  const { translator, domain, allowed, localeOf } = options
  const permits = (candidate: string): boolean =>
    candidate === domain || candidate === SHARED_DOMAIN
      || (candidate !== CORE_DOMAIN && allowed.has(candidate))
  return (key, params, locale) => {
    const at = locale ?? localeOf()
    // design §2.4: a parameter that is itself a ref renders before ICU sees it, and an array
    // joins. `permits` is the gate for a nested ref too — nothing else audits what a spore
    // hands ctx.t, and ctx.t returns the rendered string to the spore (§5.3).
    const resolve = (bag?: Record<string, unknown>): Record<string, unknown> | undefined =>
      bag == null ? undefined : resolveParams(translator, bag, at, permits)
    if (typeof key === 'string') {
      return translator.translate(domain, key, at, resolve(params))
    }
    const ref: TranslatableRef = key
    if (!permits(ref.domain)) {
      throw new Error(`translation domain '${ref.domain}' is not declared in this spore's requires`)
    }
    const merged = ref.params == null && params == null
      ? undefined
      : { ...ref.params, ...params }
    return translator.translate(ref.domain, ref.key, at, resolve(merged))
  }
}
