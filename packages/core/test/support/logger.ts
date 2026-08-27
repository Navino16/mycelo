import type { Logger } from '@mycelo/septum'

/** Discards everything: a test asserting on a return value should not print. */
export function silentLogger(): Logger {
  const noop = (): void => undefined
  return { debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger() }
}

/** Captures what was logged, as `<level> <message>`, for asserting the operator's half of a split. */
export function recordingLogger(): { logger: Logger, lines: string[] } {
  const lines: string[] = []
  const record = (level: string) => (message: string): void => { lines.push(`${level} ${message}`) }
  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  }
  return { logger, lines }
}
