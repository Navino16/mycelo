import { Outlet } from 'react-router'
import { ChromeProvider, releasedVersion, useChrome } from '../chrome.tsx'
import { CriticalBanner } from '../components/CriticalBanner.tsx'
import { formatUptime } from '../format.ts'
import { useT } from '../i18n.tsx'
import { HealthPill } from './HealthPill.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import { Nav } from './Nav.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

function VersionLine(): React.JSX.Element | null {
  const t = useT()
  const { substrate } = useChrome()
  if (substrate === null) return null
  const version = releasedVersion(substrate)
  const uptime = formatUptime(substrate.uptimeSeconds, {
    d: t('uptime.d'), h: t('uptime.h'), m: t('uptime.m'), s: t('uptime.s'),
  })
  return (
    <p className="font-mono text-meta text-text/60">
      {version !== null && `${t('chrome.version', { version })} · `}
      {t('chrome.uptime', { uptime })}
    </p>
  )
}

function Shell(): React.JSX.Element {
  const t = useT()
  const { host } = useChrome()
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: the title block 1a/1b/1c draw, minus the phone-chrome status strip (§4).
            Desktop: the sidebar carries the identity, so this row is title + search + pill. */}
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 md:hidden">
            <p className="text-page font-semibold">{t('substrate.title')}</p>
            <VersionLine />
          </div>
          <p className="hidden font-mono text-meta text-text/60 md:block">{host}</p>
          <div className="flex items-center gap-2">
            <HealthPill />
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

export function Layout(): React.JSX.Element {
  return <ChromeProvider><Shell /></ChromeProvider>
}
