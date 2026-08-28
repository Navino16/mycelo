import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'bun:test'
import { I18nProvider } from '../src/i18n.tsx'
import { ThemeToggle } from '../src/shell/ThemeToggle.tsx'

// Global constraint (brief §10): dark is the default, and the toggle must reach light too —
// both directions survived unpinned before this test (ThemeToggle.tsx:8 and its classList.toggle).
it('defaults to dark and the toggle reaches both directions', () => {
  render(<I18nProvider><ThemeToggle /></I18nProvider>)
  expect(document.documentElement.classList.contains('dark')).toBe(true)

  fireEvent.click(screen.getByRole('button'))
  expect(document.documentElement.classList.contains('dark')).toBe(false)

  fireEvent.click(screen.getByRole('button'))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
