import type { ComponentPropsWithRef } from 'react'

/**
 * The one checkbox in the SPA. A bare `<input type="checkbox">` is painted by the browser —
 * blue with a white tick in Chromium — where 2h and 2g draw the accent green sized to the row.
 * `accent-color` rather than a drawn box: it keeps the native indeterminate paint, which the
 * role editor's tri-state group boxes rely on.
 */
export function Checkbox(
  { className = '', ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type'>,
): React.JSX.Element {
  return <input type="checkbox" className={`size-4 shrink-0 accent-accent ${className}`} {...rest} />
}
