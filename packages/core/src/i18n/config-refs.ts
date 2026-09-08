import type { TranslatableRef } from '@mycelo/septum'
import { SHARED_DOMAIN } from './core-catalogs.js'
import { refusalRef } from './refusal-keys.js'
import { isRef } from './refusal.js'

/**
 * One issue as a ref. A bare `messageKey` names this spore's own domain; a `common` ref is passed
 * through; anything else — including an issue with no key at all — degrades to its English
 * `message` as a literal (design §5.2, §5.3).
 */
export function issueRef(record: Record<string, unknown>, domain: string): TranslatableRef {
  const key = record['messageKey']
  const params = typeof record['params'] === 'object' && record['params'] !== null
    ? record['params'] as Record<string, unknown>
    : undefined
  if (typeof key === 'string' && key.length > 0) {
    return { domain, key, ...(params === undefined ? {} : { params }) }
  }
  // isRef, not an inline shape test: a `messageKey` carrying a domain and no key would otherwise
  // reach the renderer as an object and print itself.
  if (isRef(key) && key.domain === SHARED_DOMAIN) {
    const merged = { ...key.params, ...params }
    return {
      domain: SHARED_DOMAIN,
      key: key.key,
      ...(Object.keys(merged).length === 0 ? {} : { params: merged }),
    }
  }
  // A literal renders as itself: translator.translate returns an absent key verbatim, and never
  // through ICU, so a message containing a brace cannot fail to parse.
  const message = typeof record['message'] === 'string' ? record['message'] : 'unspecified issue'
  return { domain: SHARED_DOMAIN, key: message }
}

/**
 * A plugin's issues as refs, so a caller holding a locale renders them. An issue with a path is
 * wrapped in `refusal.config.issueAt` so the field name survives translation — the nested-ref
 * mechanism of design §2.4, resolved depth-first by the same renderer.
 */
export function configIssueRefs(error: unknown, domain: string): readonly TranslatableRef[] {
  const issues: unknown = (error as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return []
  const refs: TranslatableRef[] = []
  for (const issue of issues as readonly unknown[]) {
    const record = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : {}
    const path: unknown = record['path']
    const field = Array.isArray(path) ? (path as readonly PropertyKey[]).map(String).join('.') : ''
    const ref = issueRef(record, domain)
    refs.push(field.length === 0
      ? ref
      : refusalRef('refusal.config.issueAt', { field, cause: ref }))
  }
  return refs
}

/**
 * The refs one key owns, out of a whole-object parse. An issue with an empty path refuses the
 * object rather than a field, so it is attributed to the key the caller named — that key is the
 * only difference between the object it parsed and the stored one.
 */
export function configIssueRefsFor(
  error: unknown, domain: string, key: string,
): readonly TranslatableRef[] {
  const issues: unknown = (error as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return []
  const mine = (issues as readonly unknown[]).filter((issue) => {
    const record = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : {}
    const path: unknown = record['path']
    if (!Array.isArray(path) || path.length === 0) return true
    return String((path as readonly PropertyKey[])[0]) === key
  })
  return configIssueRefs({ issues: mine }, domain)
}
