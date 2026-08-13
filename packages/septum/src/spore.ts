/**
 * A validator for a plugin's configuration, described structurally.
 *
 * Not typed as a Zod schema: a spore is bundled with its own copy of Zod, so a
 * schema arriving from a plugin is not an instance of the core's ZodType. Any
 * object with a compatible `safeParse` satisfies this.
 */
export interface ConfigSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown }
  /** JSON Schema for the settings form. Absent when the plugin provides none. */
  toJsonSchema?(): object
}

/** What a spore's entry module exports. One alias per kind, all sharing this base. */
export interface SporeModule<TImpl, TConfig> {
  /** Omitted when the plugin takes no configuration. */
  readonly configSchema?: ConfigSchema<TConfig>
  /** Called once per germination, after the config has been validated. */
  create(): TImpl
}
