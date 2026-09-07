export type RefusalCode =
  | 'role-unknown' | 'role-exists' | 'role-builtin' | 'role-is-default'
  | 'role-name-empty' | 'pattern-duplicate' | 'principal-unknown'
  | 'plugin-not-installed' | 'setting-undeclared'

/**
 * A refusal the caller is expected to render — an HTTP route and the mycelium mount both map the
 * code to one `common` catalogue key. Anything else thrown by the store is a fault.
 */
export class StoreRefusal extends Error {
  readonly code: RefusalCode
  /**
   * What the key's placeholders name. The thrower fills them because it is the only side that
   * knows which of its arguments the code refers to (§4).
   */
  readonly params?: Record<string, unknown>
  constructor(code: RefusalCode, message: string, params?: Record<string, unknown>) {
    super(message)
    this.name = 'StoreRefusal'
    this.code = code
    if (params !== undefined) this.params = params
  }
}

// instanceof is sound here, unlike across the plugin boundary: this class is the core's
// own, and a plugin only ever receives a refusal — it never constructs one.
export function isRefusal(e: unknown, code?: RefusalCode): e is StoreRefusal {
  return e instanceof StoreRefusal && (code === undefined || e.code === code)
}
