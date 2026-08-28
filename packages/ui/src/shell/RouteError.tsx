import { useT } from '../i18n.tsx'

// A sentence, not a diagnostic screen: react-router's default is raw English HTML,
// over the error.generic key both catalogues already carry.
export function RouteError(): React.JSX.Element {
  const t = useT()
  return <p className="p-6 text-text">{t('error.generic')}</p>
}
