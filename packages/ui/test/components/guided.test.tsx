import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { GuidedStart, outstandingSteps } from '../../src/components/GuidedStart.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import type { SubstrateCounts } from '../../src/components/GuidedStart.tsx'

function renderGuided(counts: SubstrateCounts): void {
  render(
    <I18nProvider>
      <MemoryRouter><GuidedStart counts={counts} /></MemoryRouter>
    </I18nProvider>,
  )
}

function stepNumbers(): (string | null)[] {
  return screen.getAllByRole('listitem').map((li) => li.querySelector('[data-step-number]')?.textContent ?? null)
}

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
    renderGuided({ sources: 0, channels: 0, customRoles: 0 })

    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Add the default registry' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Browse channels' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Create the default role' })).toBeDefined()
  })

  it('heads the frame with the empty-substrate headline and closes it with the registry note', () => {
    renderGuided({ sources: 0, channels: 0, customRoles: 0 })

    expect(screen.getByText('Nothing is installed yet')).toBeDefined()
    expect(screen.getByText(/A source is a git registry of plugins/)).toBeDefined()
  })

  it('numbers the three cards 1, 2, 3', () => {
    renderGuided({ sources: 0, channels: 0, customRoles: 0 })

    expect(stepNumbers()).toEqual(['1', '2', '3'])
  })

  // 1b numbers the outstanding set, not the fixed three: with the source done the channel card
  // is step 1. A badge holding each step's rank in the full list would read '2', '3' here.
  it('renumbers from 1 once an earlier step is done', () => {
    renderGuided({ sources: 1, channels: 0, customRoles: 0 })

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(stepNumbers()).toEqual(['1', '2'])
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByText('Add a source')).toBeNull()
  })
})
