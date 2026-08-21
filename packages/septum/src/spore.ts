export interface ConfigIssue {
  /** Where in the settings object the refusal applies. Empty for a whole-object refusal. */
  readonly path: readonly PropertyKey[]
  readonly message: string
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
   * Setting keys holding a credential. The core redacts them on read and refuses to write the
   * redaction mask back. `is_secret` governs redaction, not storage: the value is plain text in
   * the database.
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
