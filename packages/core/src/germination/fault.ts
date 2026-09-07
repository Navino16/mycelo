import type { TranslatableRef } from '@mycelo/septum'
import { SHARED_DOMAIN } from '../i18n/core-catalogs.js'

/**
 * Every dormancy refusal resolves in `common`: germination has no spore binding to enforce
 * `requires` with, and design §5.3 accepts no other domain there.
 */
export function dormancyRefusal(key: string, params?: Record<string, unknown>): TranslatableRef {
  return { domain: SHARED_DOMAIN, key, ...(params === undefined ? {} : { params }) }
}
