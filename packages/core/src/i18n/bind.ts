import type { Translate, TranslatableRef } from '@mycelo/septum'
import type { Translator } from './translator.js'

/** Readable by every spore, declared by none: it belongs to no plugin (design §3.1). */
const SHARED_DOMAIN = 'common'
/** The runtime's own domain, closed to plugins: its messages change without notice for them. */
const CORE_DOMAIN = 'core'

export function bindTranslate(options: {
  translator: Translator
  domain: string
  allowed: ReadonlySet<string>
  localeOf: () => string
}): Translate {
  const { translator, domain, allowed, localeOf } = options
  return (key, params, locale) => {
    if (typeof key === 'string') {
      return translator.translate(domain, key, locale ?? localeOf(), params)
    }
    const ref: TranslatableRef = key
    if (ref.domain !== domain && ref.domain !== SHARED_DOMAIN) {
      if (ref.domain === CORE_DOMAIN || !allowed.has(ref.domain)) {
        throw new Error(`translation domain '${ref.domain}' is not declared in this spore's requires`)
      }
    }
    const merged = ref.params === undefined && params === undefined
      ? undefined
      : { ...ref.params, ...params }
    return translator.translate(ref.domain, ref.key, locale ?? localeOf(), merged)
  }
}
