/**
 * The wire shapes of the HTTP API, redeclared rather than imported: packages/ui is outside the
 * root solution and has no Bun or Node types, so a core route module cannot enter this program
 * (spec §2). Every shape here was read off the route that answers it.
 */

export type SporeKind = 'hypha' | 'rhiza' | 'enzyme' | 'inhibitor'
export type PluginState = 'germinated' | 'dormant' | 'disabled' | 'pending' | 'unknown'

/** `GET /api/plugins` — api/routes/plugins.ts. */
export interface PluginDto {
  name: string
  /** Absent for a dormant entry whose manifest never parsed. */
  kind?: SporeKind
  commands: readonly string[]
  state: PluginState
  reason?: string
  enabled: boolean
  source?: string
  strain?: string
}

export interface RequirementDto {
  targets: readonly string[]
  anyOf: boolean
  optional: boolean
  scopes: readonly string[]
}

export interface CommandCapabilityDto {
  name: string
  capabilities: readonly string[]
}

export interface SporeDemands {
  requires: readonly RequirementDto[]
  scopes: readonly string[]
  externals: readonly string[]
  commands: readonly CommandCapabilityDto[]
}

/** `GET /api/plugins/:name`. Both fields absent when the manifest does not parse. */
export interface PluginDetailDto extends PluginDto {
  demands?: SporeDemands
  mounted?: readonly string[]
}

export type PluginGroups = Record<SporeKind | 'unknown', readonly PluginDto[]>

/** Discriminated on `kind` (boot/state.ts), so the diagnosis screen narrows to what it shows. */
export type GerminationFailure =
  | { kind: 'cycle', message: string, spores: readonly string[] }
  | { kind: 'collision', message: string, command: string, plugins: readonly string[] }
  | { kind: 'unknown', message: string }

export type HealthState = 'healthy' | 'degraded' | 'unreachable'

export interface HealthStatus {
  state: HealthState
  detail?: string
  /** A serialized Date: the core sends `checkedAt` through JSON.stringify. */
  checkedAt: string
}

/** `rhiza`, not `name`: septum's RhizaHealth names the connector that way. */
export interface RhizaHealth {
  rhiza: string
  status: HealthStatus
}

/** `GET /api/health` — supervision/health.ts. */
export interface RuntimeHealth {
  mode: 'germinated' | 'degraded'
  failure?: GerminationFailure
  dormant: readonly { name: string, reason: string }[]
  /** Any one entry means the bot refuses all traffic on every channel (design §7). */
  enforcingBlocked: readonly string[]
  rhizas: readonly RhizaHealth[]
}

/** `GET /api/commands` — api/routes/registry.ts. `description` is already rendered. */
export interface CommandDto {
  plugin: string
  command: string
  declared: string
  qualified: string
  description: string
  capabilities: readonly string[]
}

export type CommandGroups = Record<string, readonly CommandDto[]>

export interface GraphNode {
  name: string
  kind?: SporeKind
  state: 'germinated' | 'dormant'
  reason?: string
}

export interface GraphEdge { from: string, to: string, optional: boolean }
export interface GraphDto { nodes: readonly GraphNode[], edges: readonly GraphEdge[] }

/** `GET /api/config`. */
export interface ConfigDto {
  prefix: string
  defaultLocale: string
  defaultRole?: string
}

export interface IdentityDto { channel: string, externalId: string, displayName?: string }

/**
 * `GET /api/people`, `/api/people/:id` and `PATCH /api/people/:id` all answer septum's
 * `Principal`. It carries no reviewed flag and no creation date, even though PATCH accepts
 * `reviewed: true` — so no screen can show whether a person has been reviewed.
 */
export interface PersonDto {
  id: string
  displayName?: string
  roles: readonly string[]
  identities: readonly IdentityDto[]
}

export interface PageDto<T> {
  items: readonly T[]
  page: number
  perPage: number
  total: number
}

/** `GET /api/roles` and `/api/roles/:name` — septum's RoleInfo. */
export interface RoleDto {
  name: string
  builtin: boolean
  patterns: readonly string[]
}

/**
 * `GET /api/sources`, and what `POST /api/sources` and `PATCH /api/sources/:id` answer too.
 * `token` is the literal '••••' when one is set, never the value.
 */
export interface SourceDto {
  id: number
  label: string
  driver: 'local' | 'github'
  location: string
  official: boolean
  enabled: boolean
  token?: string
}

/** `GET /api/sources/:id/spores` — the driver's listing, which carries no description. */
export interface SporeOffer {
  name: string
  strain: string
}

export interface SporeDetail {
  name: string
  kind: SporeKind
  description: string
  septum: string
  demands: SporeDemands
}

/** `GET /api/sources/:id/spores/:name`. */
export interface SporeStrainsDto {
  strains: readonly string[]
  detail: SporeDetail
}

/** `POST /api/sources/:id/inoculate`. */
export interface InoculateOutcome {
  name: string
  strain: string
  warnings: readonly string[]
  restartRequired: true
}

/** `GET /api/setup`, the one route reachable before an account exists. */
export interface SetupState { required: boolean }

/** `GET /api/me` — a Principal plus what only the UI credential knows. */
export interface MeDto extends PersonDto {
  username: string | null
  locale: string
}

/**
 * The `{ ok: true }` answer of the auth, people, roles and plugin routes. `restartRequired`
 * is set by the plugin routes only; the source routes answer their own shapes instead.
 */
export interface MutationResult {
  ok: true
  restartRequired?: boolean
}

/** `DELETE /api/plugins/:name/commands/:command/alias` — `cleared` separates a removal from a no-op. */
export interface AliasCleared extends MutationResult {
  cleared: boolean
}

/**
 * `GET /api/plugins/:name/schema`. `secrets` is added to the available branch by task 10 step 1;
 * without it a never-yet-filled credential renders as an ordinary text field.
 */
export type FormSchema =
  | { available: true, schema: Record<string, unknown>, secrets: readonly string[] }
  | { available: false, reason: string }
