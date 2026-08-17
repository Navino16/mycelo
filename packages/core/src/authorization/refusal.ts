export type RefusalCode =
  | 'role-unknown' | 'role-exists' | 'role-builtin' | 'role-is-default'
  | 'role-name-empty' | 'pattern-duplicate' | 'principal-unknown'

/**
 * A refusal the caller is expected to render — an HTTP route maps the code to a catalogue key,
 * a chat command prints the message. Anything else thrown by the store is a fault.
 */
export class StoreRefusal extends Error {
  readonly code: RefusalCode
  constructor(code: RefusalCode, message: string) {
    super(message)
    this.name = 'StoreRefusal'
    this.code = code
  }
}

// instanceof is sound here, unlike across the plugin boundary: this class is the core's
// own, and a plugin only ever receives a refusal — it never constructs one.
export function isRefusal(e: unknown, code?: RefusalCode): e is StoreRefusal {
  return e instanceof StoreRefusal && (code === undefined || e.code === code)
}
