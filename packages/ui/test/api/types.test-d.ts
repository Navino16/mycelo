/**
 * Pins types.ts's DTO mirror against the server's real types (report: task-7-report.md).
 * `bun test` never runs `*.test-d.ts`; `tsc -b` (always run first) keeps core/dist fresh.
 */
import type {
  FormSchema as SeptumFormSchema,
  HealthStatus as SeptumHealthStatus,
  InoculateOutcome as SeptumInoculateOutcome,
  Principal,
  RoleInfo,
  SporangiumSource,
} from '@mycelo/septum'
import type { ConfigDto as CoreConfigDto } from '../../../core/dist/api/routes/config.js'
import type { RuntimeHealthDto as CoreRuntimeHealthDto } from '../../../core/dist/api/routes/health.js'
import type { PluginDto as CorePluginDto } from '../../../core/dist/api/routes/plugins.js'
import type { SubstrateDto as CoreSubstrateDto } from '../../../core/dist/api/routes/substrate.js'
import type {
  ConfigDto, FormSchema, HealthStatus, InoculateOutcome, PersonDto, PluginDto, RoleDto,
  RuntimeHealth, SourceDto, SubstrateDto,
} from '../../src/api/types.ts'

// The repo's established type-pin idiom (septum's mycelium.test-d.ts): `expect-type` is not a
// dependency here, and a plain assignment proves the same property — a required-to-optional
// relaxation on either side stops this file compiling.
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

// Omit<>/intersection reads as unequal to the flat shape it resolves to under `Equal`;
// `Flatten` forces resolution first, `FlattenUnion` per union member (report: task-7-report.md).
type Flatten<T> = { [K in keyof T]: T[K] }
type FlattenUnion<T> = T extends unknown ? Flatten<T> : never

export type PinRoleDto = Expect<Equal<RoleDto, RoleInfo>>

// checkedAt crosses the wire as a JSON string (Fastify's JSON.stringify); septum's own shape
// carries a Date, as read straight off a rhiza's or hypha's health() call.
export type PinHealthStatus = Expect<Equal<HealthStatus,
  Flatten<Omit<SeptumHealthStatus, 'checkedAt'> & { checkedAt: string }>
>>

type SeptumFormAvailable = Extract<SeptumFormSchema, { available: true }>
type SeptumFormUnavailable = Extract<SeptumFormSchema, { available: false }>

// The route adds `secrets` and drops reasonKey/reasonParams (task 10, design §5.2); schema
// narrows object to Record<string, unknown> for property access (report: task-7-report.md).
export type PinFormSchema = Expect<Equal<FormSchema,
  FlattenUnion<
    | (Omit<SeptumFormAvailable, 'schema'> & { schema: Record<string, unknown>, secrets: readonly string[] })
    | Omit<SeptumFormUnavailable, 'reasonKey' | 'reasonParams'>
  >
>>

// api/routes/sources.ts flattens `warnings` from InoculateWarning[] to the translated
// sentence alone; the key and params never reach the wire.
export type PinInoculateOutcome = Expect<Equal<InoculateOutcome,
  Flatten<Omit<SeptumInoculateOutcome, 'warnings'> & { warnings: readonly string[] }>
>>

// people.ts's own PersonDto (Principal + reviewed) is not exported; reconstructed here.
export type PinPersonDto = Expect<Equal<PersonDto, Flatten<Principal & { reviewed: boolean }>>>

export type PinSourceDto = Expect<Equal<SourceDto, SporangiumSource>>

export type PinConfigDto = Expect<Equal<ConfigDto, CoreConfigDto>>

export type PinSubstrateDto = Expect<Equal<SubstrateDto, CoreSubstrateDto>>

// scopes is deliberately widened from MyceliumScope to string on the UI side (types.ts's own
// comment on RequirementDto): a scope the UI's septum version does not recognise must still
// render as a fallback (DemandsList, demands.test.tsx), not fail to typecheck a fixture.
export type PinPluginDto = Expect<Equal<PluginDto,
  Flatten<Omit<CorePluginDto, 'scopes'> & { scopes: readonly string[] }>
>>

// hyphae reached the wire when core's RuntimeHealth gained it (task 4); rhizas/hyphae's
// status.checkedAt crosses as a wire string though the type still says Date (report).
type WireHealth<T extends { status: SeptumHealthStatus }> = Flatten<Omit<T, 'status'> & { status: HealthStatus }>

export type PinRuntimeHealth = Expect<Equal<RuntimeHealth,
  Flatten<Omit<CoreRuntimeHealthDto, 'rhizas' | 'hyphae'> & {
    rhizas: readonly WireHealth<CoreRuntimeHealthDto['rhizas'][number]>[]
    hyphae: readonly WireHealth<CoreRuntimeHealthDto['hyphae'][number]>[]
  }>
>>
