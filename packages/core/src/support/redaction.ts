/** One spelling, read and written. A second literal is a desync waiting for a mutation to find. */
export const REDACTED = '••••'

/**
 * Strips a credential-looking userinfo segment: the last @ before the first / — WHATWG's own
 * delimiter — in either authority ("scheme://user:pass@host/…") or opaque ("scheme:user:pass@host/…",
 * no //) form. An @ appearing after the path is untouched.
 */
export function redactCredentials(location: string): string {
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(location)
  const afterScheme = schemeMatch === null ? 0 : schemeMatch[0].length
  const authorityStart = location.startsWith('//', afterScheme) ? afterScheme + 2 : afterScheme
  const pathStart = location.indexOf('/', authorityStart)
  const authorityEnd = pathStart === -1 ? location.length : pathStart
  const at = location.slice(authorityStart, authorityEnd).lastIndexOf('@')
  if (at === -1) return location
  return location.slice(0, authorityStart) + location.slice(authorityStart + at + 1)
}
