import type { ConfigIssue, TranslatableRef } from '@mycelo/septum'
import type { Translator } from './translator.js'

/** design §4: the one core-owned domain a spore may read without declaring it. */
const SHARED_DOMAIN = 'common'

/**
 * design §2.4: real depth is bounded by germination's DAG; this caps a ref built by hand
 * elsewhere. The cap renders rather than throwing — an innermost key beats a stack overflow
 * mid-request.
 */
const MAX_DEPTH = 8

/**
 * design §2.4: exact, and narrower than "looks like an object" — a plain object with string
 * `domain` and `key` fields only. No parameter this design produces has that shape, so a
 * collision must be authored deliberately.
 */
function isRef(value: unknown): value is TranslatableRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  const record = value as Record<string, unknown>
  return typeof record['domain'] === 'string' && typeof record['key'] === 'string'
}

/**
 * design §2.4: a ref renders depth-first; an array renders element-wise and joins. The join stays
 * here because `IntlMessageFormat.format` returns an array for a non-primitive parameter, and
 * stringifying that prepends a comma. Measured 2026-09-04.
 */
function resolveValue(translator: Translator, value: unknown, locale: string, depth: number): unknown {
  if (isRef(value)) return render(translator, value, locale, depth + 1)
  if (Array.isArray(value)) {
    return (value as readonly unknown[])
      .map((item) => (isRef(item) ? render(translator, item, locale, depth + 1) : String(item)))
      .join(', ')
  }
  return value
}

function resolveParams(
  translator: Translator, params: Record<string, unknown>, locale: string, depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(params)) {
    out[name] = resolveValue(translator, value, locale, depth)
  }
  return out
}

function render(translator: Translator, ref: TranslatableRef, locale: string, depth: number): string {
  if (depth > MAX_DEPTH) return ref.key
  // A plugin's own ref may carry `params: null` at runtime despite the type — untyped across
  // the plugin boundary, so `== null` catches it alongside `undefined`.
  const params = ref.params == null
    ? undefined
    : resolveParams(translator, ref.params, locale, depth)
  return translator.translate(ref.domain, ref.key, locale, params)
}

/**
 * Renders a refusal the core built, in the reader's locale. A parameter that is itself a ref is
 * rendered first, so a dormancy reason quoting another spore's reason is translated all the way
 * down rather than half-frozen in the builder's language (design §2.4).
 */
export function renderRefusal(
  translator: Translator, ref: TranslatableRef, locale: string,
): string {
  return render(translator, ref, locale, 0)
}

/**
 * design §5.3: a bare key resolves in the producing spore's own domain; a ref is honoured only
 * for `common`. Any other domain falls back to `message` — this code has no `bindTranslate`
 * binding to enforce `requires` with.
 */
export function renderConfigIssue(
  translator: Translator, issue: ConfigIssue, domain: string, locale: string,
): string {
  const key = issue.messageKey
  if (typeof key === 'string' && key.length > 0) {
    // Through resolveParams too, or a plugin's array parameter bypasses the join above.
    // `== null` also catches a plugin's `params: null` at runtime, untyped at this boundary.
    const params = issue.params == null
      ? undefined
      : resolveParams(translator, issue.params, locale, 0)
    return translator.translate(domain, key, locale, params)
  }
  if (isRef(key) && key.domain === SHARED_DOMAIN) {
    const merged = issue.params === undefined && key.params === undefined
      ? undefined
      : { ...key.params, ...issue.params }
    return render(
      translator,
      { domain: key.domain, key: key.key, ...(merged === undefined ? {} : { params: merged }) },
      locale,
      0,
    )
  }
  return issue.message
}
