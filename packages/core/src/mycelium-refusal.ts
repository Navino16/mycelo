import type { Outcome, OutcomeOf, TranslatableRef } from '@mycelo/septum'
import type { RefusalCode } from './authorization/refusal.js'
import { isRefusal } from './authorization/refusal.js'
import { SHARED_DOMAIN } from './i18n/core-catalogs.js'

/**
 * `Record<RefusalCode, string>` and not a partial one: a code added to `RefusalCode` without a key
 * here must not compile, or the mount hands a spore a raw code the day that code first fires.
 */
const KEYS: Record<RefusalCode, string> = {
  'role-unknown': 'refusal.role.notFound',
  'role-exists': 'refusal.role.exists',
  'role-builtin': 'refusal.role.builtin',
  'role-is-default': 'refusal.role.isDefault',
  'role-name-empty': 'refusal.role.nameEmpty',
  'pattern-duplicate': 'refusal.role.patternDuplicate',
  'principal-unknown': 'refusal.person.notFound',
  'plugin-not-installed': 'refusal.plugin.notInstalled',
  'setting-undeclared': 'refusal.plugin.settingUndeclared',
}

export function refusalKeyOf(code: RefusalCode): string {
  return KEYS[code]
}

function asRefusal(e: unknown): TranslatableRef | null {
  if (!isRefusal(e)) return null
  const { params } = e
  return {
    domain: SHARED_DOMAIN,
    key: refusalKeyOf(e.code),
    ...(params === undefined ? {} : { params }),
  }
}

/**
 * Replaces `toPromise()` for a method that can refuse. A non-`StoreRefusal` propagates: a SQLite
 * failure reported as a refusal sends the operator after a role that was never the problem.
 */
export async function outcome(work: () => void | Promise<void>): Promise<Outcome> {
  try {
    await work()
    return { ok: true }
  } catch (e) {
    const refusal = asRefusal(e)
    if (refusal === null) throw e
    return { ok: false, refusal }
  }
}

/** `OutcomeOf`'s refusal arm carries no `value`: `undefined as never` would let an unnarrowed caller read it. */
export async function outcomeOf<T>(work: () => T | Promise<T>): Promise<OutcomeOf<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (e) {
    const refusal = asRefusal(e)
    if (refusal === null) throw e
    return { ok: false, refusal }
  }
}
