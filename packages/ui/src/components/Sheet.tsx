import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** A bottom sheet on mobile, a right panel above md (2d-sources-mobile-add.png). */
export function Sheet(
  { title, open, onClose, children }: {
    title: string, open: boolean, onClose: () => void, children: ReactNode,
  },
): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const node = panel.current
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') { onClose(); return }
    if (event.key !== 'Tab' || panel.current === null) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) return
    // Only the two edges are handled; every Tab in between stays the browser's, or the
    // sheet becomes untabbable.
    const edge = event.shiftKey ? first : last
    if (document.activeElement !== edge) return
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center md:items-stretch md:justify-end">
      <button
        type="button"
        data-testid="sheet-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        className="relative max-h-[85vh] w-full space-y-4 overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 md:max-h-full md:w-100 md:rounded-none md:rounded-l-2xl"
      >
        {/* The drag handle the artboard draws; on the desktop panel it means nothing. */}
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line md:hidden" />
        <h2 className="text-title font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
