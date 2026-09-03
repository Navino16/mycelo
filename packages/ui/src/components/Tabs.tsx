import { Link } from 'react-router'

export interface Tab {
  id: string
  label: string
  count?: number
  /** A tab that is a route of its own (1c's Configuration), rendered as a link. */
  to?: string
}

/**
 * 1c's underlined strip. No `role="tablist"`: one of its tabs navigates away instead of
 * switching a panel, and a tablist whose item is a link is not one.
 */
export function Tabs(
  { tabs, active, onSelect }: {
    tabs: readonly Tab[]
    active: string
    onSelect: (id: string) => void
  },
): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => {
        const current = tab.id === active
        const shape = [
          'flex items-baseline gap-1.5 border-b-2 px-3 py-2 text-body',
          current ? 'border-accent font-medium' : 'border-transparent text-text/60',
        ].join(' ')
        const body = (
          <>
            <span>{tab.label}</span>
            {tab.count !== undefined && <span className="font-mono text-meta-lg">{String(tab.count)}</span>}
          </>
        )
        if (tab.to !== undefined) {
          return (
            <Link
              key={tab.id}
              to={tab.to}
              data-tab={tab.id}
              aria-current={current ? 'page' : undefined}
              className={shape}
            >
              {body}
            </Link>
          )
        }
        return (
          <button
            key={tab.id}
            type="button"
            data-tab={tab.id}
            aria-pressed={current}
            onClick={() => { onSelect(tab.id) }}
            className={shape}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
