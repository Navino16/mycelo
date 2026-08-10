import type { Logger } from '@mycelo/septum'

/** Console logger. Replaced when supervision lands (phase 6). */
export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const emit = (level: string, message: string, meta?: Record<string, unknown>): void => {
    const payload = { ...bindings, ...meta }
    const suffix = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : ''
    console.log(`[${level}] ${message}${suffix}`)
  }
  return {
    debug: (m, meta) => { emit('debug', m, meta) },
    info: (m, meta) => { emit('info', m, meta) },
    warn: (m, meta) => { emit('warn', m, meta) },
    error: (m, meta) => { emit('error', m, meta) },
    child: (extra) => createLogger({ ...bindings, ...extra }),
  }
}
