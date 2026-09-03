import { readArray } from './api/read.ts'
import { grants, wildcardsIn } from './patterns.ts'
import type { CommandDto, CommandGroups, RoleDto } from './api/types.ts'

/** The patterns of every named role that the roles list actually holds, in one flat list. */
function patternsOf(roles: readonly string[], allRoles: readonly RoleDto[]): readonly string[] {
  const held = new Set(readArray<string>(roles) ?? [])
  return (readArray<RoleDto>(allRoles) ?? [])
    .filter((r) => held.has(r.name))
    .flatMap((r) => readArray<string>(r.patterns) ?? [])
}

/** Every command a person may run, from their roles' patterns (authorize()'s three forms). */
export function effectiveCommands(
  roles: readonly string[], allRoles: readonly RoleDto[], commands: CommandGroups,
): readonly CommandDto[] {
  const patterns = patternsOf(roles, allRoles)
  if (patterns.length === 0) return []
  if (commands === null || typeof commands !== 'object' || Array.isArray(commands)) return []
  return Object.values(commands)
    .flatMap((group) => readArray<CommandDto>(group) ?? [])
    .filter((c) => grants(patterns, c.qualified))
}

/** The wildcards their roles hold, deduplicated. Empty means "no wildcard applies". */
export function effectiveWildcards(
  roles: readonly string[], allRoles: readonly RoleDto[],
): readonly string[] {
  return [...new Set(wildcardsIn(patternsOf(roles, allRoles)))]
}
