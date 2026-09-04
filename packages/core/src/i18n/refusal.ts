import type { ConfigIssue, TranslatableRef } from '@mycelo/septum'
import type { Translator } from './translator.js'

/** design §4: the one core-owned domain a spore may read without declaring it. */
const SHARED_DOMAIN = 'common'

/**
 * design §2.4. Germination's resolution is a DAG — resolve() refuses a cycle before any of this
 * runs — so the real depth is the topological one. The cap guards a ref built by hand elsewhere,
 * and it renders rather than throwing: a stack overflow while answering a request is worse than
 * an outermost sentence whose {cause} shows the innermost key.
 */
const MAX_DEPTH = 8

/**
 * design §2.4: exact, and deliberately narrower than "looks like an object". No parameter this
 * design produces carries a string `domain` and a string `key` — the mapping table emits
 * `expected`, `origin`, `minimum`, `maximum`, `format`, `values`, `divisor`, `keys` — so a
 * collision has to be authored deliberately.
 */
function isRef(value: unknown): value is TranslatableRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  const record = value as Record<string, unknown>
  return typeof record['domain'] === 'string' && typeof record['key'] === 'string'
}

/**
 * A ref renders; an array is rendered element-wise and joined. The join is here and not left to
 * ICU because `IntlMessageFormat.format` returns an **array** when any parameter is not a
 * primitive, and stringifying that prepends a comma — `{values}` with `['a','b']` renders
 * `", a, b"`. Measured 2026-09-04.
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
  const params = ref.params === undefined
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
 * design §5.3. A bare `messageKey` resolves in the producing spore's own domain; a ref is honoured
 * only for `common`. Any other domain — `core` included, and a spore the plugin genuinely declares
 * in `requires` — falls back to `message`: the code rendering a config refusal runs in a route or
 * in germination with no `bindTranslate` binding at hand, so honouring an arbitrary domain here
 * would hand a plugin a read channel that binding refuses it elsewhere.
 */
export function renderConfigIssue(
  translator: Translator, issue: ConfigIssue, domain: string, locale: string,
): string {
  const key = issue.messageKey
  if (typeof key === 'string' && key.length > 0) {
    // Through resolveParams too, or a plugin's array parameter bypasses the join above.
    const params = issue.params === undefined
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
