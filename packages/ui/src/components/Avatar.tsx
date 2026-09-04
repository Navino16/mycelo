import type { PersonDto } from '../api/types.ts'

/** Initials from a display name, or the first two characters of the id when there is none. */
export function initialsOf(person: { displayName?: string, id: string }): string {
  const words = (person.displayName ?? '').trim().split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) return person.id.slice(0, 2).toUpperCase()
  const first = words[0] ?? ''
  // One word still gets two letters: a lone initial in a 32px circle reads as noise.
  const second = words.length === 1 ? first.slice(1, 2) : (words[words.length - 1] ?? '').slice(0, 1)
  return (first.slice(0, 1) + second).toUpperCase()
}

export function Avatar({ person }: { person: PersonDto }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface2 text-meta font-medium text-text/70"
    >
      {initialsOf(person)}
    </span>
  )
}
