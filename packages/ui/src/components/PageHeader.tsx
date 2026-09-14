import { useChrome } from '../chrome.tsx'
import { HealthPill } from '../shell/HealthPill.tsx'
import { LanguageSwitch } from '../shell/LanguageSwitch.tsx'
import { ThemeToggle } from '../shell/ThemeToggle.tsx'

/**
 * The chrome bar's replacement (ruling 1a-R4): above md the sidebar foot carries language and
 * theme (task 4), so this row carries only title, actions and the pill. Below md there is no
 * sidebar, so the row carries language and theme too — order utilities move `actions` and
 * `subtitle` between the row and their own line per breakpoint without rendering either twice.
 */
export function PageHeader(
  { title, subtitle, actions }: {
    title: React.ReactNode
    subtitle?: React.ReactNode
    actions?: React.ReactNode
  },
): React.JSX.Element {
  const { counts } = useChrome()

  return (
    <header className="flex flex-wrap items-center gap-3">
      <h1 className="order-1 text-page font-semibold">{title}</h1>

      {actions !== undefined && (
        <div
          data-testid="pageheader-actions"
          className="order-4 flex w-full items-center md:order-2 md:w-auto md:flex-1 md:justify-center"
        >
          {actions}
        </div>
      )}

      <div className="order-2 ml-auto flex items-center gap-3 md:order-3">
        <div data-testid="pageheader-mobile-controls" className="flex items-center gap-2 md:hidden">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <HealthPill plugins={counts?.plugins} />
      </div>

      {subtitle !== undefined && (
        <p className="order-3 w-full text-body text-text/70 md:order-4">{subtitle}</p>
      )}
    </header>
  )
}
