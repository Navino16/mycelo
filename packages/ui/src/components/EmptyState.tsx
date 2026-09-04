import type { ReactNode } from 'react'

// Dashed border, as 1a-overview-mobile-healthy-light.png draws it: the only rendered empty
// state in the bundle, and the dash is what separates "nothing to show" from a real card.
export function EmptyState(
  { title, body, action }: { title: string, body: string, action?: ReactNode },
): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-line bg-surface p-6 text-center">
      <p className="text-title font-medium">{title}</p>
      <p className="mx-auto max-w-md text-body text-text/70">{body}</p>
      {action !== undefined && <div className="pt-1">{action}</div>}
    </div>
  )
}
