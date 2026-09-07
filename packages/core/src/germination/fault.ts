import type { TranslatableRef } from '@mycelo/septum'
import { SHARED_DOMAIN } from '../i18n/core-catalogs.js'

/**
 * A refusal and the English sentence it replaces, carried together for the length of the
 * migration: `message` fills `Dormant.reason` and `refusal` fills `Dormant.refusal`, and
 * `message` goes away with that field (plan task 8).
 */
export interface Fault {
  readonly message: string
  readonly refusal: TranslatableRef
}

/**
 * Every dormancy refusal resolves in `common`: germination has no spore binding to enforce
 * `requires` with, and design §5.3 accepts no other domain there.
 */
export function fault(
  message: string, key: string, params?: Record<string, unknown>,
): Fault {
  return {
    message,
    refusal: { domain: SHARED_DOMAIN, key, ...(params === undefined ? {} : { params }) },
  }
}
