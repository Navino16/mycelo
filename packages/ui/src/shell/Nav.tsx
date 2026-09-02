import { Boxes, KeyRound, LayoutDashboard, Network, Radio, Users } from 'lucide-react'
import { NavLink } from 'react-router'
import { releasedVersion, useChrome } from '../chrome.tsx'
import { Dot } from '../components/Dot.tsx'
import { formatUptime } from '../format.ts'
import { useT } from '../i18n.tsx'
import type { ChromeCounts } from '../chrome.tsx'
import type { Tone } from '../components/tone.ts'
import type { StringKey } from '../../locales/en.ts'

interface Item {
  to: string
  key: StringKey
  Icon: typeof Boxes
  count?: (counts: ChromeCounts) => number
  /** Amber when the count names a problem rather than a size (design's `Overview 5`). */
  problem?: boolean
  desktopOnly?: boolean
}

const ITEMS: readonly Item[] = [
  { to: '/', key: 'nav.overview', Icon: LayoutDashboard, count: (c) => c.issues, problem: true },
  { to: '/plugins', key: 'nav.plugins', Icon: Boxes, count: (c) => c.plugins },
  // Kept on the phone bar although the design's four-item bar omits it: journey B starts here
  // and brief §4 requires every journey to be completable on a phone.
  { to: '/sources', key: 'nav.sources', Icon: Radio, count: (c) => c.sources },
  { to: '/roles', key: 'nav.roles', Icon: KeyRound, count: (c) => c.roles },
  { to: '/people', key: 'nav.people', Icon: Users, count: (c) => c.people },
  { to: '/graph', key: 'nav.graph', Icon: Network, desktopOnly: true },
]

function Foot(): React.JSX.Element | null {
  const t = useT()
  const { substrate } = useChrome()
  if (substrate === null) return null
  const version = releasedVersion(substrate)
  const uptime = formatUptime(substrate.uptimeSeconds, {
    d: t('uptime.d'), h: t('uptime.h'), m: t('uptime.m'), s: t('uptime.s'),
  })
  return (
    <div className="hidden border-t border-line px-4 py-3 font-mono text-meta text-text/50 md:block">
      {version !== null && <p>{t('chrome.version', { version })}</p>}
      <p>{t('chrome.uptime', { uptime })}</p>
    </div>
  )
}

export function Nav(): React.JSX.Element {
  const t = useT()
  const { counts, host } = useChrome()
  return (
    // md:w-54 is the design's 216 px sidebar.
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface
                    md:static md:h-dvh md:w-54 md:shrink-0 md:flex-col md:border-r md:border-t-0">
      <div className="hidden border-b border-line px-4 py-4 md:block">
        <p className="font-semibold">{t('app.name')}</p>
        <p className="font-mono text-meta text-text/60">{host}</p>
      </div>
      <div className="flex flex-1 md:flex-col md:overflow-y-auto md:py-2">
        {ITEMS.map(({ to, key, Icon, count, problem, desktopOnly }) => {
          const n = counts === null || count === undefined ? undefined : count(counts)
          const tone: Tone = problem === true && n !== undefined && n > 0 ? 'warn' : 'idle'
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => [
                'flex flex-1 flex-col items-center gap-1 p-3 text-meta',
                'md:flex-none md:flex-row md:gap-3 md:px-4 md:py-2 md:text-title',
                desktopOnly === true ? 'hidden md:flex' : '',
                isActive ? 'text-text md:bg-surface2' : 'text-text/70',
              ].join(' ')}
            >
              {/* The dot is the desktop sidebar's marker and the icon the phone bar's:
                  1a draws one of the two per width, never both. */}
              <span className="hidden md:block"><Dot tone={tone} /></span>
              <Icon size={18} className="md:hidden" />
              <span className="md:flex-1">{t(key)}</span>
              {n !== undefined && (
                <span className={`hidden font-mono text-meta md:inline ${tone === 'warn' ? 'text-warn' : 'text-text/50'}`}>
                  {String(n)}
                </span>
              )}
            </NavLink>
          )
        })}
      </div>
      <Foot />
    </nav>
  )
}
