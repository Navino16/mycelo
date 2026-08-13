/** Coercion to string happens in here too: a hostile `message` can return an object that resists it. */
export function describeThrown(e: unknown): string {
  try {
    const detail: unknown = e instanceof Error ? `${e.message}` : 'unknown error'
    return typeof detail === 'string' ? detail : 'unknown error'
  } catch {
    return 'unknown error'
  }
}
