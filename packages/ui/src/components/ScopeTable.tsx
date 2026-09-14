import { useT } from '../i18n.tsx'
import { SCOPE_SENTENCE, riskOf } from '../scopes.ts'
import { Dot } from './Dot.tsx'
import { TONE_CLASSES } from './tone.ts'

const COLUMNS = 'md:grid-cols-[auto_11rem_minmax(0,1fr)_3rem]'

/**
 * One row per requested scope (2b). R7: the grade is a word, not only a dot colour — the
 * amber dot alone is unreadable to whoever cannot tell it from the grey one.
 */
export function ScopeTable({ scopes }: { scopes: readonly string[] }): React.JSX.Element {
  const t = useT()
  return (
    <>
      <div
        data-testid="scope-table-header"
        className={`hidden gap-x-3 border-b border-line px-3 py-2 text-meta uppercase tracking-wide text-text/60 md:grid ${COLUMNS}`}
      >
        <span />
        <span>{t('spore.colScope')}</span>
        <span>{t('spore.colAllows')}</span>
        <span>{t('spore.colRisk')}</span>
      </div>
      <ul data-testid="scope-table" className="divide-y divide-line-soft">
        {scopes.map((scope) => {
          const risk = riskOf(scope)
          const tone = risk === 'high' ? 'warn' : 'idle'
          const sentence = SCOPE_SENTENCE[scope]
          return (
            <li
              key={scope}
              data-scope={scope}
              data-risk={risk}
              className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 p-3 ${COLUMNS}`}
            >
              <Dot tone={tone} />
              <code className="font-mono text-body">{scope}</code>
              <span className="col-span-2 text-body text-text/70 md:col-span-1">
                {sentence === undefined ? '' : t(sentence)}
              </span>
              <span className={`text-meta-lg md:text-right ${TONE_CLASSES[tone].text}`}>
                {t(risk === 'high' ? 'spore.riskHigh' : 'spore.riskLow')}
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
