/**
 * The logging surface handed to plugins. Deliberately minimal and structurally
 * compatible with pino and winston, so the core can swap implementations without
 * touching the contract.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  /** Returns a logger that adds `bindings` to every record. */
  child(bindings: Record<string, unknown>): Logger
}
