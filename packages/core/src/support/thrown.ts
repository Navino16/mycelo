/**
 * Renders a plugin's own refusal into one line: `path: message`, joined with `; `. Reaches a
 * client through `enablePlugin` and an operator's log through germination — like `describeThrown`
 * beside it, duck-typed: a spore's own contract can still be wrong, and the core never checks a
 * manifest's `septum:` field, so an older or malformed plugin's `error` can be anything.
 */
export function describeConfigError(error: unknown): string {
  const issues = (error as { issues?: unknown } | null)?.issues
  if (Array.isArray(issues) && issues.length > 0) return issues.map(describeConfigIssue).join('; ')
  // A pre-0.8 plugin's `error` carries no issues at all, and its own sentence says more than
  // the generic line below — which is the whole audience of this guard.
  if (typeof error === 'string' && error.length > 0) return error
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'the plugin reported no further detail'
}

/** `String()`, never `.join()`, on the raw path: `Array.prototype.join` throws on a symbol. */
function describeConfigIssue(issue: unknown): string {
  const record = typeof issue === 'object' && issue !== null ? issue as Record<string, unknown> : {}
  const path = Array.isArray(record.path) ? record.path : []
  const message = typeof record.message === 'string' ? record.message : 'unspecified issue'
  const rendered = path.map((p: unknown) => String(p)).join('.')
  return rendered.length === 0 ? message : `${rendered}: ${message}`
}

/** Coercion to string happens in here too: a hostile `message` can return an object that resists it. */
export function describeThrown(e: unknown): string {
  try {
    const detail: unknown = e instanceof Error ? `${e.message}` : 'unknown error'
    return typeof detail === 'string' ? detail : 'unknown error'
  } catch {
    return 'unknown error'
  }
}

/**
 * For an operator log only, never a client: keeps the stack, unlike `describeThrown`, whose
 * output reaches the API through `GerminationFailure.message` and would leak absolute paths.
 */
export function describeFault(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message
  try {
    return String(e)
  } catch {
    return 'unknown error'
  }
}
