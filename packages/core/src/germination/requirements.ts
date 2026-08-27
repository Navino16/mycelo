import type { ChannelCapability, Manifest, MyceliumScope, Requirement } from '@mycelo/septum'

/**
 * One requirement, flattened. `Requirement` is a union of a single form and an `any_of` group,
 * and a screen with a union to discriminate is a screen with a branch to get wrong.
 */
export interface RequirementDto {
  /** One entry for a single requirement; every alternative of an `any_of` group. */
  targets: readonly string[]
  anyOf: boolean
  optional: boolean
  /** Only ever non-empty for the mycelium, which is the one target with a scope model. */
  scopes: readonly MyceliumScope[]
}

/** Each command's own capability demand, which the emitting channel must declare. */
export interface CommandCapabilityDto {
  name: string
  capabilities: readonly ChannelCapability[]
}

/** What a spore is asking for, in the shape a consent screen renders (spec §4). */
export interface SporeDemands {
  requires: readonly RequirementDto[]
  scopes: readonly MyceliumScope[]
  externals: readonly string[]
  commands: readonly CommandCapabilityDto[]
}

// A target may carry its own range — `radarr@^2` — and is passed through whole: a screen
// showing 'radarr' where the manifest demanded 'radarr@^2' would understate the demand.
function requirementDto(requirement: Requirement): RequirementDto {
  if ('any_of' in requirement) {
    return {
      targets: requirement.any_of.map((alternative) => alternative.rhiza),
      anyOf: true, optional: false, scopes: [],
    }
  }
  return {
    targets: [requirement.rhiza],
    anyOf: false,
    optional: requirement.optional,
    scopes: requirement.scopes ?? [],
  }
}

export function demandsOf(manifest: Manifest): SporeDemands {
  const requires = (manifest.requires ?? []).map(requirementDto)
  return {
    requires,
    // The mycelium's scopes are declared per requirement, so the flat list a consent screen
    // shows is their union rather than a field of its own.
    scopes: [...new Set(requires.flatMap((r) => r.scopes))],
    externals: manifest.externals ?? [],
    commands: manifest.kind === 'enzyme'
      ? manifest.commands.map((command) => ({
        name: command.name,
        capabilities: command.capabilities ?? [],
      }))
      : [],
  }
}
