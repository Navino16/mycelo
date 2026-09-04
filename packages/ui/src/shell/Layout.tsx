import { Outlet } from 'react-router'
import { ChromeProvider, useChrome } from '../chrome.tsx'
import { HealthPill } from './HealthPill.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import { Nav } from './Nav.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

function Shell(): React.JSX.Element {
  const { counts } = useChrome()
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Only what persists across every screen: the pill (R8) and the two chrome controls.
            The title block 1a draws is the Overview's own, and 1b's is the Plugins screen's. */}
        <header className="flex items-center justify-end gap-2 border-b border-line px-4 py-3">
          <HealthPill plugins={counts?.plugins} />
          <LanguageSwitch />
          <ThemeToggle />
        </header>
        <main className="min-w-0 flex-1 p-4 pb-20 md:pb-4"><Outlet /></main>
      </div>
    </div>
  )
}

export function Layout(): React.JSX.Element {
  return <ChromeProvider><Shell /></ChromeProvider>
}
