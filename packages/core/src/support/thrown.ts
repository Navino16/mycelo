import type { ConfigError } from '@mycelo/septum'

/** Renders a plugin's own refusal into one line: `path: message`, joined, path omitted when empty. */
export function describeConfigError(error: ConfigError): string {
  return error.issues.map((i) => (i.path.length === 0 ? i.message : `${i.path.join('.')}: ${i.message}`)).join('; ')
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
