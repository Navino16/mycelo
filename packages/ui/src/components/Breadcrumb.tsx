import { Link } from 'react-router'

export function Breadcrumb(
  { trail }: { trail: readonly { label: string, to?: string }[] },
): React.JSX.Element {
  return (
    <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 text-meta-lg text-text/60">
      {trail.map((crumb, i) => (
        <span key={crumb.label} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">{'›'}</span>}
          {crumb.to === undefined ? crumb.label : <Link to={crumb.to} className="hover:text-text">{crumb.label}</Link>}
        </span>
      ))}
    </nav>
  )
}
