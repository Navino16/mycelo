import { Boxes, Network, Users, KeyRound, Radio, LayoutDashboard } from 'lucide-react'
import { NavLink } from 'react-router'
import { useT } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

const ITEMS: readonly { to: string, key: StringKey, Icon: typeof Boxes, desktopOnly?: boolean }[] = [
  { to: '/', key: 'nav.overview', Icon: LayoutDashboard },
  { to: '/plugins', key: 'nav.plugins', Icon: Boxes },
  { to: '/sources', key: 'nav.sources', Icon: Radio },
  { to: '/roles', key: 'nav.roles', Icon: KeyRound },
  { to: '/people', key: 'nav.people', Icon: Users },
  { to: '/graph', key: 'nav.graph', Icon: Network, desktopOnly: true },
]

export function Nav(): React.JSX.Element {
  const t = useT()
  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-line bg-surface
                    md:static md:h-full md:w-56 md:flex-col md:border-r md:border-t-0">
      {ITEMS.map(({ to, key, Icon, desktopOnly }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => [
            'flex flex-1 flex-col items-center gap-1 p-3 text-xs md:flex-none md:flex-row md:gap-3 md:text-sm',
            desktopOnly === true ? 'hidden md:flex' : '',
            isActive ? 'text-accent' : 'text-text/70',
          ].join(' ')}
        >
          <Icon size={18} />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}
