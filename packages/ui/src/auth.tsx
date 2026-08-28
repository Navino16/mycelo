import { createContext, use, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, onUnauthenticated } from './api/client.ts'
import type { MeDto } from './api/types.ts'
import { Login } from './screens/Login.tsx'
import { Setup } from './screens/Setup.tsx'

export type { MeDto } from './api/types.ts'

type Gate = 'checking' | 'login' | 'setup' | 'open'

interface MeState { me: MeDto | null, refresh: () => void }

const MeContext = createContext<MeState | null>(null)

export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [gate, setGate] = useState<Gate>('checking')
  const [me, setMe] = useState<MeDto | null>(null)

  const refresh = useCallback(() => {
    api.get<MeDto>('/api/me').then(
      (m) => { setMe(m); setGate('open') },
      () => undefined,
    )
  }, [])

  useEffect(() => {
    onUnauthenticated(setGate)
    refresh()
  }, [refresh])

  if (gate === 'checking') return null
  if (gate === 'setup') return <Setup onDone={() => { setGate('login') }} />
  // refresh, not a plain 'open': a login answers 200 with no body, so the session's
  // principal is only known once /api/me is fetched with the new cookie.
  if (gate === 'login') return <Login onDone={refresh} />
  return <MeContext value={{ me, refresh }}>{children}</MeContext>
}

export function useMe(): MeState {
  const ctx = use(MeContext)
  if (ctx === null) throw new Error('useMe outside AuthGate')
  return ctx
}
