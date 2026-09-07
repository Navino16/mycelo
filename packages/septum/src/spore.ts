import type { TranslatableRef } from './context.js'

export interface ConfigIssue {
  /** Where in the settings object the refusal applies. Empty for a whole-object refusal. */
  readonly path: readonly PropertyKey[]
  /**
   * English, and what the operator's log reads: a translated log cannot be grepped. Also the
   * fallback for an issue with no key, which is the pre-0.12 rendering unchanged (§5.2).
   */
  readonly message: string
  /**
   * A key in the producing spore's own domain, or a ref — honoured only for `common` (§5.3).
   *
   * Not named `key`: zod's `$ZodIssueInvalidElement` carries `key: unknown`, so that name makes a
   * raw ZodError stop satisfying ConfigError, which spore.test-d.ts asserts and every
   * hand-written safeParse relies on.
   */
  readonly messageKey?: string | TranslatableRef
  readonly params?: Record<string, unknown>
}

export interface ConfigError {
  readonly issues: readonly ConfigIssue[]
}

/**
 * A validator for a plugin's configuration, described structurally.
 *
 * Not typed as a Zod schema: a spore is bundled with its own copy of Zod, so a
 * schema arriving from a plugin is not an instance of the core's ZodType. Any
 * object with a compatible `safeParse` satisfies this — but "compatible" now has a
 * stated shape: `error` must carry `issues`, not any value.
 */
export interface ConfigSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: ConfigError }
  /**
   * JSON Schema for the settings form. Absent when the plugin provides none — which also
   * leaves `plugins.configure`'s `setSetting` unable to refuse an undeclared key.
   */
  toJsonSchema?(): object
  /**
   * Setting keys holding a credential. The core flags them on write, redacts them on read and
   * refuses to write the redaction mask back over one. `is_secret` governs redaction, not
   * storage: the value is plain text in the database.
   *
   * Redaction follows the write, not the declaration, so two cases are served in the clear —
   * a value stored before the plugin declared its key, and one written while the plugin's
   * module throws at import, where the core cannot read `secrets` at all. Writing the value
   * again, once the declaration is readable, is what promotes the row.
   */
  readonly secrets?: readonly string[]
}

/** What a spore's entry module exports. One alias per kind, all sharing this base. */
export interface SporeModule<TImpl, TConfig> {
  /** Omitted when the plugin takes no configuration. */
  readonly configSchema?: ConfigSchema<TConfig>
  /** Called once per germination, after the config has been validated. */
  create(): TImpl
}
