import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { GuidedStart, outstandingSteps } from '../../src/components/GuidedStart.tsx'
import { I18nProvider } from '../../src/i18n.tsx'

describe('the guided empty substrate', () => {
  it('names all three moves on a substrate with nothing at all', () => {
    expect(outstandingSteps({ sources: 0, channels: 0, customRoles: 0 }))
      .toEqual(['source', 'channel', 'role'])
  })

  // The steps are ticked off one at a time, which is what makes it a path rather than a list.
  it('drops a step once it is done, keeping the rest', () => {
    expect(outstandingSteps({ sources: 1, channels: 0, customRoles: 0 }))
      .toEqual(['channel', 'role'])
  })

  it('is finished when a source, a channel and a role exist', () => {
    expect(outstandingSteps({ sources: 1, channels: 1, customRoles: 1 })).toEqual([])
  })

  it('renders one card per outstanding move, each with its own call to action', () => {
    render(
      <I18nProvider>
        <MemoryRouter><GuidedStart counts={{ sources: 0, channels: 0, customRoles: 0 }} /></MemoryRouter>
      </I18nProvider>,
    )
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })
})
