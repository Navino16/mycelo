import { Outlet } from 'react-router'
import { CriticalBanner } from '../components/CriticalBanner.tsx'
import { useT } from '../i18n.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import { Nav } from './Nav.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export function Layout(): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-medium">{t('app.name')}</span>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
        </header>
        <CriticalBanner />
        <main className="min-w-0 flex-1 p-4 pb-20 md:pb-4"><Outlet /></main>
      </div>
    </div>
  )
}
