import { Boxes, KeyRound, LayoutDashboard, Network, Radio, Users } from 'lucide-react'
import { NavLink } from 'react-router'
import { useChrome, useUptimeLine } from '../chrome.tsx'
import { Dot } from '../components/Dot.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'
import type { ChromeCounts } from '../chrome.tsx'
import type { Tone } from '../components/tone.ts'
import type { StringKey } from '../../locales/en.ts'

interface Item {
  to: string
  key: StringKey
  Icon: typeof Boxes
  count?: (counts: ChromeCounts) => number | undefined
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
  const line = useUptimeLine()
  if (line === null) return null
  return (
    <div className="hidden border-t border-line px-4 py-3 font-mono text-meta text-text/50 md:block">
      {line}
    </div>
  )
}

export function Nav(): React.JSX.Element {
  const t = useT()
  const { counts, host } = useChrome()
  return (
    // md:w-54 is the design's 216 px sidebar; sticky so it stays in reach on a long page.
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface
                    md:sticky md:top-0 md:h-dvh md:w-54 md:shrink-0 md:flex-col md:border-r md:border-t-0">
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
                'flex flex-1 flex-col items-center gap-1 border-t-2 border-transparent p-3 text-meta',
                'md:flex-none md:flex-row md:gap-3 md:border-t-0 md:px-4 md:py-2 md:text-title',
                desktopOnly === true ? 'hidden md:flex' : '',
                // The phone bar marks the active item with an accent rule and accent ink; the
                // desktop sidebar has room for a filled row instead (1a).
                isActive ? 'border-accent text-accent md:bg-surface2 md:text-text' : 'text-text/70',
              ].join(' ')}
            >
              {/* The dot is the desktop sidebar's marker and the icon the phone bar's:
                  1a draws one of the two per width, never both. */}
              <span className="hidden md:block"><Dot tone={tone} /></span>
              <Icon size={18} className="md:hidden" />
              <span className="md:flex-1">{t(key)}</span>
              {n !== undefined && (
                <span className={`hidden font-mono text-meta md:inline ${tone === 'warn' ? TONE_CLASSES.warn.text : 'text-text/50'}`}>
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
