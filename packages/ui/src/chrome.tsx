import { createContext, use, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { api } from './api/client.ts'
import { readArray } from './api/read.ts'
import { ORDER } from './api/types.ts'
import { useHealth } from './health.tsx'
import { countUnhealthyRhizas } from './shell/HealthPill.tsx'
import type {
  PageDto, PersonDto, PluginDto, PluginGroups, RoleDto, SourceDto, SubstrateDto,
} from './api/types.ts'

export interface ChromeCounts {
  plugins: number
  /** Dormant plugins plus unhealthy rhizas — the design's `Overview 5`. */
  issues: number
  sources: number
  roles: number
  people: number
}

export interface ChromeValue {
  substrate: SubstrateDto | null
  counts: ChromeCounts | null
  /** The design's `substrate.home.lan`. Never served: the URL bar is the honest source. */
  host: string
}

export const ChromeContext = createContext<ChromeValue | null>(null)

/**
 * The version to show, or null. `0.0.0` is packages/core/package.json's unreleased placeholder
 * (phase 9.8 cuts the real one), and printing it in the chrome is noise, not information.
 */
export function releasedVersion(substrate: SubstrateDto | null): string | null {
  const version = substrate?.version
  if (typeof version !== 'string' || version === '' || version === '0.0.0') return null
  return version
}

export function ChromeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { pathname } = useLocation()
  const { health } = useHealth()
  const [substrate, setSubstrate] = useState<SubstrateDto | null>(null)
  const [counts, setCounts] = useState<ChromeCounts | null>(null)
  // Read once, lazily: `location` is mutable global state, and reading it on every render
  // makes this component impure for no gain — the host cannot change without a reload.
  const [host] = useState(() => globalThis.location?.host ?? '')

  useEffect(() => {
    api.get<SubstrateDto>('/api/substrate').then(setSubstrate, () => undefined)
  }, [])

  // Refetched per route, not once: the SPA has no cache to invalidate, so a count taken at
  // mount would still read 2 sources after an operator added a third.
  useEffect(() => {
    Promise.all([
      api.get<unknown>('/api/plugins'),
      api.get<unknown>('/api/sources'),
      api.get<unknown>('/api/roles'),
      api.get<unknown>('/api/people?perPage=1'),
    ]).then(([plugins, sources, roles, people]) => {
      const groups = plugins as PluginGroups | null
      const all = ORDER.flatMap((kind) => readArray<PluginDto>(groups?.[kind]) ?? [])
      setCounts({
        plugins: all.length,
        issues: all.filter((p) => p.state === 'dormant').length,
        sources: (readArray<SourceDto>(sources) ?? []).length,
        roles: (readArray<RoleDto>(roles) ?? []).length,
        people: (people as PageDto<PersonDto> | null)?.total ?? 0,
      })
    }, () => undefined)
  }, [pathname])

  // The rhiza half of `Overview 5` comes from the health poll, which already refreshes itself.
  const unhealthy = countUnhealthyRhizas(health)
  const value: ChromeValue = {
    substrate,
    counts: counts === null ? null : { ...counts, issues: counts.issues + unhealthy },
    host,
  }
  return <ChromeContext value={value}>{children}</ChromeContext>
}

export function useChrome(): ChromeValue {
  const ctx = use(ChromeContext)
  if (ctx === null) throw new Error('useChrome outside ChromeProvider')
  return ctx
}
