import type { Logger } from '@mycelo/septum'

/** Discards everything: a test asserting on a return value should not print. */
export function silentLogger(): Logger {
  const noop = (): void => undefined
  return { debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger() }
}
