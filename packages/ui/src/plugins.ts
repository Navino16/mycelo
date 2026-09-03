import { readArray } from './api/read.ts'
import { ORDER } from './api/types.ts'
import type { PluginDto } from './api/types.ts'

/**
 * `GET /api/plugins`, indexed by name for the source screens' joins. `null` means the join
 * answered nothing usable — a refusal, or a shape that is not the group object — which a
 * screen must render as silence, never as "not installed".
 */
export function pluginsByName(groups: unknown): ReadonlyMap<string, PluginDto> | null {
  if (typeof groups !== 'object' || groups === null || Array.isArray(groups)) return null
  const record = groups as Partial<Record<string, unknown>>
  return new Map(
    ORDER.flatMap((kind) => readArray<PluginDto>(record[kind]) ?? []).map((p) => [p.name, p]),
  )
}
