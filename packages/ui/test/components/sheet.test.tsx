import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { Sheet } from '../../src/components/Sheet.tsx'

function open(onClose = mock(() => {})): { onClose: ReturnType<typeof mock> } {
  render(
    <Sheet title="Add a source" open onClose={onClose}>
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </Sheet>,
  )
  return { onClose }
}

describe('the sheet', () => {
  it('renders nothing at all while closed', () => {
    render(<Sheet title="Add a source" open={false} onClose={() => {}}><button type="button">x</button></Sheet>)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('x')).toBeNull()
  })

  it('names itself with its title when open', () => {
    open()

    expect(screen.getByRole('dialog', { name: 'Add a source' })).toBeDefined()
  })

  it('closes on Escape', () => {
    const { onClose } = open()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop behind it is clicked', () => {
    const { onClose } = open()

    fireEvent.click(screen.getByTestId('sheet-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The trap: the sheet overlays the page, so a Tab escaping it lands on controls the
  // operator cannot see. Forward from the last wraps to the first.
  it('wraps focus from the last control back to the first on Tab', () => {
    open()
    const last = screen.getByText('last')
    last.focus()
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(last, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('wraps focus from the first control back to the last on Shift+Tab', () => {
    open()
    const first = screen.getByText('first')
    first.focus()

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByText('last'))
  })

  // The discriminating half of the trap: a handler that pulled focus to the first control on
  // every Tab would pass the wrap case above and make the sheet untabbable.
  it('leaves a Tab in the middle of the sheet to the browser', () => {
    open()
    const middle = screen.getByText('middle')
    middle.focus()

    fireEvent.keyDown(middle, { key: 'Tab' })

    expect(document.activeElement).toBe(middle)
  })

  it('moves focus into the sheet when it opens, so the keyboard is already inside', () => {
    open()

    expect(document.activeElement).toBe(screen.getByText('first'))
  })
})
