import { createContext, use, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api/client.ts'
import type { RuntimeHealth } from './api/types.ts'

// Exported, and named for what it is rather than 'HealthState': api/types.ts already exports a
// HealthState (a rhiza's healthy/degraded/unreachable), and a same-named local type would collide
// on any file importing both.
export interface HealthContextValue {
  health: RuntimeHealth | null
  error: boolean
  refresh: () => Promise<void>
}

export const HealthContext = createContext<HealthContextValue | null>(null)

// Exported so a test can assert against the real interval rather than a copied literal.
export const POLL_MS = 15_000

export function HealthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [health, setHealth] = useState<RuntimeHealth | null>(null)
  const [error, setError] = useState(false)

  // Not async: react-hooks/set-state-in-effect flags setState reachable synchronously from an
  // async function's body, even past an await. A .then chain is the shape auth.tsx already uses.
  const refresh = useCallback((): Promise<void> => api.get<RuntimeHealth>('/api/health').then(
    (h) => { setHealth(h); setError(false) },
    () => { setError(true) },
  ), [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  return <HealthContext value={{ health, error, refresh }}>{children}</HealthContext>
}

export function useHealth(): HealthContextValue {
  const ctx = use(HealthContext)
  if (ctx === null) throw new Error('useHealth outside HealthProvider')
  return ctx
}
