import { z } from 'zod'

import { CHANNEL_CAPABILITIES } from './capabilities.js'

/** Plugin kinds. Not an enum: Node's type-stripping cannot handle enums. */
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
  args: z.array(argSpecSchema).optional(),
}

// A union rather than a .refine(): z.infer then yields a type TypeScript narrows,
// so the core's dispatch needs no branch for a case the schema already forbids.
const respondCommandSchema = z.object({
  ...commandBase,
  respond: z.string().min(1),
  code: z.undefined().optional(),
})

// Not nameSchema: a handler name is an object key, and nameSchema forbids capitals.
const codeCommandSchema = z.object({
  ...commandBase,
  code: z.string().min(1),
  respond: z.undefined().optional(),
})

const commandSpecSchema = z.union([respondCommandSchema, codeCommandSchema])
export type CommandSpec = z.infer<typeof commandSpecSchema>

const singleRequirementSchema = z.object({
  rhiza: targetSchema,
  scopes: z.array(z.string()).optional(),
  optional: z.boolean().default(false),
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
  throw new ManifestError(issue?.message ?? 'invalid manifest', path)
}
