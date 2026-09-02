import { createContext, use, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { api } from './api/client.ts'
import { readArray } from './api/read.ts'
import { ORDER } from './api/types.ts'
import { formatUptime } from './format.ts'
import { useHealth } from './health.tsx'
import { useT } from './i18n.tsx'
import { countUnhealthyRhizas } from './shell/HealthPill.tsx'
import type {
  PageDto, PersonDto, PluginDto, PluginGroups, RoleDto, SourceDto, SubstrateDto,
} from './api/types.ts'

/** Every count is optional: one refused route must not blank the other four. */
export interface ChromeCounts {
  plugins?: number
  /** Dormant plugins plus unhealthy rhizas — the design's `Overview 5`. */
  issues?: number
  sources?: number
  roles?: number
  people?: number
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
 * Private: useUptimeLine is the one sanctioned way to render it, so the rule lives in one place.
 */
function releasedVersion(substrate: SubstrateDto | null): string | null {
  const version = substrate?.version
  if (typeof version !== 'string' || version === '' || version === '0.0.0') return null
  return version
}

/**
 * The finished chrome line: `mycelo 0.9.3 · up 14d 03h`, or the uptime alone while the version
 * is the placeholder. null means render nothing — an unreadable uptime must not become `up 0s`,
 * which is indistinguishable from a fresh boot.
 */
export function useUptimeLine(): string | null {
  const t = useT()
  const { substrate } = useChrome()
  if (substrate === null || !Number.isFinite(substrate.uptimeSeconds)) return null
  const uptime = t('chrome.uptime', {
    uptime: formatUptime(substrate.uptimeSeconds, {
      d: t('uptime.d'), h: t('uptime.h'), m: t('uptime.m'), s: t('uptime.s'),
    }),
  })
  const version = releasedVersion(substrate)
  return version === null ? uptime : `${t('chrome.version', { version })} · ${uptime}`
}

function fulfilled(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'fulfilled' ? result.value : undefined
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

  // allSettled, not all: a principal refused one of these routes would otherwise lose all five
  // counts. Refetched per route, since the SPA has no cache a mutation could invalidate.
  useEffect(() => {
    void Promise.allSettled([
      api.get<unknown>('/api/plugins'),
      api.get<unknown>('/api/sources'),
      api.get<unknown>('/api/roles'),
      api.get<unknown>('/api/people?perPage=1'),
    ]).then(([plugins, sources, roles, people]) => {
      const groups = fulfilled(plugins) as PluginGroups | null | undefined
      const all = plugins.status === 'fulfilled'
        ? ORDER.flatMap((kind) => readArray<PluginDto>(groups?.[kind]) ?? [])
        : undefined
      setCounts({
        plugins: all?.length,
        issues: all === undefined ? undefined : all.filter((p) => p.state === 'dormant').length,
        sources: sources.status === 'fulfilled'
          ? (readArray<SourceDto>(fulfilled(sources)) ?? []).length
          : undefined,
        roles: roles.status === 'fulfilled' ? (readArray<RoleDto>(fulfilled(roles)) ?? []).length : undefined,
        people: (fulfilled(people) as PageDto<PersonDto> | null | undefined)?.total,
      })
    })
  }, [pathname])

  // The rhiza half of `Overview 5` comes from the health poll, which already refreshes itself.
  const unhealthy = countUnhealthyRhizas(health)
  const value: ChromeValue = {
    substrate,
    counts: counts === null
      ? null
      : { ...counts, issues: counts.issues === undefined ? undefined : counts.issues + unhealthy },
    host,
  }
  return <ChromeContext value={value}>{children}</ChromeContext>
}

export function useChrome(): ChromeValue {
  const ctx = use(ChromeContext)
  if (ctx === null) throw new Error('useChrome outside ChromeProvider')
  return ctx
}
