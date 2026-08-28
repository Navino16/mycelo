import { useLocale, useT } from '../i18n.tsx'

export function LanguageSwitch(): React.JSX.Element {
  const t = useT()
  const { locale, setLocale } = useLocale()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('lang.switch')}</span>
      <select
        value={locale}
        onChange={(e) => { setLocale(e.target.value === 'fr' ? 'fr' : 'en') }}
        className="rounded-md border border-line bg-surface px-2 py-1"
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    </label>
  )
}
