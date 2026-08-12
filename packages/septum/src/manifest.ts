import { z } from 'zod'

import { CHANNEL_CAPABILITIES } from './capabilities.js'
import { MYCELIUM_SCOPES } from './mycelium.js'

/** Plugin kinds. */
export const SPORE_KINDS = ['hypha', 'rhiza', 'enzyme', 'inhibitor'] as const
export type SporeKind = (typeof SPORE_KINDS)[number]

/** Plugin and command names: lowercase, digits, dashes. Used in authorization identifiers. */
const nameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase alphanumeric with dashes')

/** A dependency target, optionally carrying a semver range: "radarr" or "radarr@^2". */
const targetSchema = z.string().regex(/^[a-z][a-z0-9-]*(@.+)?$/)

const argSpecSchema = z.object({
  name: nameSchema,
  description: z.string(),
  required: z.boolean().default(false),
})
export type ArgSpec = z.infer<typeof argSpecSchema>

const commandBase = {
  name: nameSchema,
  description: z.string().min(1),
}

// A union rather than a .refine(): z.infer then yields a type TypeScript narrows,
// so the core's dispatch needs no branch for a case the schema already forbids.
const respondCommandSchema = z.object({
  ...commandBase,
  respond: z.string().min(1),
  code: z.undefined().optional(),
  // Object schemas strip unknown keys by default, which would silently drop an
  // args a respond: command has no way to honour instead of rejecting it.
  args: z.undefined().optional(),
})

// `args` lives here only: a respond: command is a plain string with no
// interpolation, so an arg declared on one could never mean anything.
// Not nameSchema: a handler name is an object key, and nameSchema forbids capitals.
const codeCommandSchema = z.object({
  ...commandBase,
  code: z.string().min(1),
  respond: z.undefined().optional(),
  args: z.array(argSpecSchema).optional(),
})

const commandSpecSchema = z.union([respondCommandSchema, codeCommandSchema])
export type CommandSpec = z.infer<typeof commandSpecSchema>

const singleRequirementSchema = z
  .object({
    rhiza: targetSchema,
    scopes: z.array(z.enum(MYCELIUM_SCOPES)).optional(),
    optional: z.boolean().default(false),
  })
  // Only the mycelium has a scope model. Ignoring the field elsewhere would let an
  // author believe they had constrained something (core spec §6.1).
  .refine((r) => r.scopes === undefined || r.rhiza === 'mycelium', {
    message: "scopes apply only to rhiza 'mycelium'",
    path: ['scopes'],
  })

const anyOfRequirementSchema = z.object({
  any_of: z.array(z.object({ rhiza: targetSchema })).min(2),
})

const requirementSchema = z.union([singleRequirementSchema, anyOfRequirementSchema])
export type Requirement = z.infer<typeof requirementSchema>

/** Fields every manifest carries. */
const commonFields = {
  name: nameSchema,
  septum: z.string().min(1),
  description: z.string().optional(),
  externals: z.array(z.string()).optional(),
  requires: z.array(requirementSchema).optional(),
}

const hyphaManifestSchema = z.object({
  ...commonFields,
  kind: z.literal('hypha'),
  capabilities: z.array(z.enum(CHANNEL_CAPABILITIES)).default([]),
})

const rhizaManifestSchema = z.object({
  ...commonFields,
  kind: z.literal('rhiza'),
})

const enzymeManifestSchema = z.object({
  ...commonFields,
  kind: z.literal('enzyme'),
  commands: z.array(commandSpecSchema).min(1),
})

const inhibitorManifestSchema = z.object({
  ...commonFields,
  kind: z.literal('inhibitor'),
  enforcing: z.boolean().default(false),
})

export const manifestSchema = z.discriminatedUnion('kind', [
  hyphaManifestSchema,
  rhizaManifestSchema,
  enzymeManifestSchema,
  inhibitorManifestSchema,
])

export type HyphaManifest = z.infer<typeof hyphaManifestSchema>
export type RhizaManifest = z.infer<typeof rhizaManifestSchema>
export type EnzymeManifest = z.infer<typeof enzymeManifestSchema>
export type InhibitorManifest = z.infer<typeof inhibitorManifestSchema>
export type Manifest = z.infer<typeof manifestSchema>

/** Thrown when a manifest is invalid. `path` names the offending field. */
export class ManifestError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(message)
    this.name = 'ManifestError'
    this.path = path
  }
}

function isUnknownArray(x: unknown): x is readonly unknown[] {
  return Array.isArray(x)
}

/** True when a raw command object carries both `respond` and `code`, or neither. */
function violatesExclusivity(command: unknown): boolean {
  if (typeof command !== 'object' || command === null) return false
  const c = command as Record<string, unknown>
  const hasRespond = Object.hasOwn(c, 'respond') && c['respond'] !== undefined
  const hasCode = Object.hasOwn(c, 'code') && c['code'] !== undefined
  return hasRespond === hasCode
}

/**
 * Validate an unknown value as a spore manifest.
 * Throws ManifestError naming the first offending path, so germination
 * diagnostics can point at a field rather than dumping a Zod tree.
 */
export function parseManifest(input: unknown): Manifest {
  const result = manifestSchema.safeParse(input)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  const path = issue?.path.length ? issue.path.join('.') : 'kind'

  // The command union fails as a whole (no field-level issue) whenever a command
  // is not an object at all, or carries both/neither of respond and code. Only the
  // latter two are the exclusivity violation; the rest keep Zod's own message.
  if (issue && issue.path.length === 2 && issue.path[0] === 'commands' && typeof input === 'object' && input !== null) {
    const commands = (input as Record<string, unknown>)['commands']
    const index = issue.path[1]
    if (Array.isArray(commands) && typeof index === 'number' && violatesExclusivity(commands[index])) {
      throw new ManifestError('a command must declare exactly one of respond: or code:', path)
    }
  }

  // The requirement union fails as a whole, so a misspelled scope reports `Invalid input`
  // unless the branch the author clearly meant is surfaced. Mirrors the commands case above.
  // `Array.isArray` narrows an `unknown` argument to `any[]` (lib.es5.d.ts), so a local
  // predicate is used instead to keep the branches genuinely unknown until asserted.
  if (issue && issue.path[0] === 'requires' && 'errors' in issue) {
    const branches = (issue as { errors?: unknown }).errors
    const first = isUnknownArray(branches) ? branches[0] : undefined
    const inner = isUnknownArray(first) ? (first[0] as { message?: unknown; path?: unknown }) : undefined
    if (inner !== undefined && typeof inner.message === 'string') {
      const innerPath = isUnknownArray(inner.path) ? inner.path : []
      throw new ManifestError(inner.message, [...issue.path, ...innerPath].join('.'))
    }
  }

  throw new ManifestError(issue?.message ?? 'invalid manifest', path)
}
