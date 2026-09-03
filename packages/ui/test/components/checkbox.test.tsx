import { readFileSync, readdirSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { Checkbox } from '../../src/components/Checkbox.tsx'

/**
 * Measured on a People row: `className: ""`, `accent-color: auto`, `appearance: auto`, so the
 * browser painted its platform default — blue with a white tick in Chromium — where 2h and 2g
 * draw the accent green. It was the only control in the SPA outside the token set.
 */
describe('the checkbox primitive', () => {
  it('paints the box with the accent token rather than the browser default', () => {
    render(<Checkbox aria-label="pick me" />)
    const box = screen.getByLabelText('pick me')

    expect(box.getAttribute('type')).toBe('checkbox')
    expect(box.className).toContain('accent-accent')
    expect(box.className).toContain('size-4')
  })

  it('keeps a caller’s own classes beside its own', () => {
    render(<Checkbox aria-label="pick me" className="mt-1" />)

    expect(screen.getByLabelText('pick me').className).toContain('mt-1')
    expect(screen.getByLabelText('pick me').className).toContain('accent-accent')
  })
})

const SRC = new URL('../../src/', import.meta.url).pathname
const SCANNED = ['components', 'shell', 'screens'] as const

function sourcesIn(dir: string): readonly string[] {
  return readdirSync(SRC + dir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => `${dir}/${name}`)
}

describe('the primitive is the only checkbox', () => {
  it('finds no bare checkbox input outside the primitive itself', () => {
    const offenders = SCANNED.flatMap((dir) => sourcesIn(dir))
      .filter((file) => file !== 'components/Checkbox.tsx')
      .filter((file) => readFileSync(SRC + file, 'utf8').includes('type="checkbox"'))

    expect(offenders).toEqual([])
  })
})
