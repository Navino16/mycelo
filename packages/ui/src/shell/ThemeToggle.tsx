import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '../i18n.tsx'

export function ThemeToggle(): React.JSX.Element {
  const t = useT()
  const [dark, setDark] = useState(() => globalThis.localStorage?.getItem('mycelo.theme') !== 'light')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    globalThis.localStorage?.setItem('mycelo.theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <button
      type="button"
      aria-label={t('theme.toggle')}
      onClick={() => { setDark((d) => !d) }}
      className="rounded-md border border-line p-2"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
