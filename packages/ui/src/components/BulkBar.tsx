import { plural, useT } from '../i18n.tsx'

/**
 * The bulk row of `2h`: docked above the mobile nav bar, an ordinary row above md. It renders
 * with nothing selected too, because the never-reviewed offer is what starts a selection.
 */
export function BulkBar(
  { count, roles, neverReviewed, onClear, onAddRole, onRemoveRole, onMarkReviewed, onSelectNeverReviewed, message }: {
    count: number
    roles: readonly string[]
    /** Undefined while that one count is unresolved, which withholds the offer entirely. */
    neverReviewed?: number
    onClear: () => void
    onAddRole: (role: string) => void
    onRemoveRole: (role: string) => void
    onMarkReviewed: () => void
    onSelectNeverReviewed?: () => void
    message?: string
  },
): React.JSX.Element | null {
  const t = useT()
  // Null rather than a boolean, so the count is narrowed where the label needs it.
  const offer = onSelectNeverReviewed !== undefined && neverReviewed !== undefined && neverReviewed > 0
    ? neverReviewed
    : null
  if (count === 0 && message === undefined && offer === null) return null

  const picker = 'rounded-md border border-line bg-surface px-3 py-1.5 text-body'
  return (
    <div
      className={[
        'flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3',
        // Docked above the nav bar while a selection is live; an ordinary row once it is not,
        // or the offer alone would cover the last table row on a phone.
        count > 0 ? 'fixed inset-x-0 bottom-16 z-20 md:static md:inset-auto' : '',
      ].join(' ')}
    >
      {count > 0 && (
        <>
          <span className="text-body font-medium">
            {plural(t, 'people.selected', count, { count })}
          </span>
          <select
            aria-label={t('people.addRole')}
            value=""
            onChange={(e) => { onAddRole(e.target.value) }}
            className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-accent-ink"
          >
            <option value="">{t('people.addRole')}</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select
            aria-label={t('people.removeRole')}
            value=""
            onChange={(e) => { onRemoveRole(e.target.value) }}
            className={picker}
          >
            <option value="">{t('people.removeRole')}</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <button type="button" onClick={onMarkReviewed} className={picker}>
            {t('people.markReviewed')}
          </button>
          <button type="button" onClick={onClear} className="text-body text-text/60 hover:text-text">
            {t('people.clear')}
          </button>
        </>
      )}
      {offer !== null && (
        <button
          type="button"
          onClick={onSelectNeverReviewed}
          className="text-body text-text/60 hover:text-text md:ml-auto"
        >
          {plural(t, 'people.selectNeverReviewed', offer, { count: offer })}
        </button>
      )}
      {/* Not role="alert": every screen on this branch reads queryByRole('alert') as
          "an error banner", and this reports an outcome. */}
      {message !== undefined && <p role="status" className="w-full text-body">{message}</p>}
    </div>
  )
}
