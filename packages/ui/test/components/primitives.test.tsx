import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { AttentionTable } from '../../src/components/AttentionTable.tsx'
import { Avatar, initialsOf } from '../../src/components/Avatar.tsx'
import { Breadcrumb } from '../../src/components/Breadcrumb.tsx'
import { Chip } from '../../src/components/Chip.tsx'
import { Dot } from '../../src/components/Dot.tsx'
import { EmptyState } from '../../src/components/EmptyState.tsx'
import { ProportionBar } from '../../src/components/ProportionBar.tsx'
import { StateBadge, toneOf } from '../../src/components/StateBadge.tsx'
import { Tabs } from '../../src/components/Tabs.tsx'
import { Tile } from '../../src/components/Tile.tsx'
import { TONE_CLASSES } from '../../src/components/tone.ts'
import { I18nProvider } from '../../src/i18n.tsx'
import type { PluginState } from '../../src/api/types.ts'
// Deliberately through Dot rather than tone.ts: tasks 16-22 take `Tone` from the primitive
// they already import, and only a use in type position proves that re-export resolves.
import type { Tone } from '../../src/components/Dot.tsx'

const ALL: readonly PluginState[] = ['germinated', 'dormant', 'disabled', 'pending', 'unknown']
const TONES: readonly Tone[] = ['ok', 'warn', 'crit', 'idle']

describe('the state palette', () => {
  // design note 2j: red is the mute bot's alone across the whole UI. Before this task
  // StateBadge painted `dormant` crit, which is the violation this case exists to catch.
  it('paints a dormant plugin amber, never red', () => {
    render(<I18nProvider><StateBadge state="dormant" /></I18nProvider>)

    expect(screen.getByText('Dormant').getAttribute('data-tone')).toBe('warn')
  })

  it('gives no plugin state the mute colour at all', () => {
    expect(ALL.map(toneOf)).not.toContain('crit')
  })

  // inventory §1.5: the SPA's own two states have no artboard and must keep their meaning.
  it('moves unknown to idle and keeps pending amber, which the design has no frame for', () => {
    expect(toneOf('pending')).toBe('warn')
    expect(toneOf('unknown')).toBe('idle')
  })

  // design note 1b: colour alone never carries meaning, so the dot is decorative and the
  // word is the signal. A dot that reached the accessibility tree would be the failure.
  it('names the state in words beside the dot, and hides the dot from assistive tech', () => {
    const { container } = render(<I18nProvider><StateBadge state="germinated" /></I18nProvider>)

    expect(screen.getByText('Germinated')).toBeDefined()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })

  // A dot on a solid fill of its own tone would vanish; the mute pill is the one place
  // 2j draws that, so it takes the ink instead.
  it('paints the dot in its tone normally, and in the ink on a solid fill', () => {
    const plain = render(<Dot tone="crit" />).container
    const solid = render(<Dot tone="crit" onSolid />).container

    expect(plain.querySelector('span')?.className).toContain(TONE_CLASSES.crit.fill)
    expect(solid.querySelector('span')?.className).not.toContain(TONE_CLASSES.crit.fill)
    expect(solid.querySelector('span')?.className).toContain('bg-current')
  })

  it('gives every tone all four classes, so no primitive falls back to an empty string', () => {
    for (const tone of TONES) {
      const classes = TONE_CLASSES[tone]
      expect([classes.text, classes.bg, classes.fill, classes.border].filter((c) => c === ''))
        .toHaveLength(0)
    }
  })
})

describe('the proportion bar', () => {
  it('sizes every segment by its share, not just the first', () => {
    const { container } = render(<ProportionBar segments={[
      { tone: 'ok', value: 28, label: 'germinated' },
      { tone: 'warn', value: 3, label: 'dormant' },
      { tone: 'idle', value: 1, label: 'disabled' },
    ]} />)

    const widths = [...container.querySelectorAll('[data-segment]')].map((e) => (e as HTMLElement).style.width)
    expect(widths).toEqual(['87.5%', '9.375%', '3.125%'])
  })

  it('renders nothing rather than dividing by zero on an empty substrate', () => {
    const { container } = render(<ProportionBar segments={[{ tone: 'ok', value: 0, label: 'germinated' }]} />)

    expect(container.querySelectorAll('[data-segment]')).toHaveLength(0)
  })
})

describe('the tile', () => {
  it('renders the label, the hero value and the note', () => {
    render(
      <I18nProvider><MemoryRouter>
        <Tile label="People" value="128" note="14 never reviewed" noteTone="warn" to="/people" />
      </MemoryRouter></I18nProvider>,
    )

    expect(screen.getByText('People')).toBeDefined()
    expect(screen.getByText('128')).toBeDefined()
    expect(screen.getByText('14 never reviewed')).toBeDefined()
    expect(screen.getByRole('link')).toHaveProperty('pathname', '/people')
  })

  it('is a plain block, not a link, when it leads nowhere', () => {
    render(<I18nProvider><MemoryRouter><Tile label="Commands" value="104" /></MemoryRouter></I18nProvider>)

    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the chip', () => {
  // 1b-plugins-desktop.png: the filter chips are buttons, the count chips beside a section
  // title are not. A chip that was always a button would put four unusable buttons on 1b.
  it('is a button only when it has something to do', () => {
    const { rerender } = render(<I18nProvider><Chip label="All" count={32} /></I18nProvider>)
    expect(screen.queryByRole('button')).toBeNull()

    let clicks = 0
    rerender(<I18nProvider><Chip label="All" count={32} onClick={() => { clicks += 1 }} active /></I18nProvider>)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)
    expect(clicks).toBe(1)
  })
})

describe('the breadcrumb', () => {
  it('links every crumb but the last, which is where the reader already is', () => {
    render(
      <MemoryRouter>
        <Breadcrumb trail={[{ label: 'Plugins', to: '/plugins' }, { label: 'radarr' }]} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Plugins' })).toHaveProperty('pathname', '/plugins')
    expect(screen.queryByRole('link', { name: 'radarr' })).toBeNull()
    expect(screen.getByRole('navigation').textContent).toContain('radarr')
  })
})

describe('the empty state', () => {
  it('renders the headline, the body and the one action', () => {
    render(
      <EmptyState
        title="Nothing needs attention"
        body="All channels connected."
        action={<button type="button">Re-run checks</button>}
      />,
    )

    expect(screen.getByText('Nothing needs attention')).toBeDefined()
    expect(screen.getByText('All channels connected.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Re-run checks' })).toBeDefined()
  })

  it('renders without an action rather than an empty slot', () => {
    render(<EmptyState title="Nothing here" body="Yet." />)

    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the tab strip', () => {
  const TABS = [
    { id: 'diagnosis', label: 'Diagnosis' },
    { id: 'configuration', label: 'Configuration', to: '/plugins/radarr/settings' },
    { id: 'commands', label: 'Commands', count: 12 },
  ]

  function renderTabs(onSelect: (id: string) => void = () => undefined): void {
    render(
      <MemoryRouter><Tabs tabs={TABS} active="diagnosis" onSelect={onSelect} /></MemoryRouter>,
    )
  }

  it('reports the tab that was chosen, not merely that something was clicked', () => {
    const chosen: string[] = []
    renderTabs((id) => { chosen.push(id) })

    fireEvent.click(screen.getByRole('button', { name: /Commands/ }))

    expect(chosen).toEqual(['commands'])
  })

  // 1c's Configuration tab is a route of its own, so it must be a link a browser can open in
  // a new window — a button calling onSelect would navigate nowhere.
  it('renders a tab carrying a route as a link to it', () => {
    renderTabs()

    expect(screen.getByRole('link', { name: 'Configuration' }).getAttribute('href'))
      .toBe('/plugins/radarr/settings')
    expect(screen.queryByRole('button', { name: 'Configuration' })).toBeNull()
  })

  it('marks the active tab as the current one, and no other', () => {
    renderTabs()

    expect(screen.getByRole('button', { name: 'Diagnosis' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Commands/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('carries a tab count beside its label, in its own node', () => {
    renderTabs()

    expect(screen.getByText('12').className).toContain('font-mono')
  })
})

describe('a person avatar', () => {
  it('takes one initial from the first word and one from the last', () => {
    expect(initialsOf({ displayName: 'Marion Barbier', id: 'x' })).toBe('MB')
    expect(initialsOf({ displayName: 'Jean Marc Dupont', id: 'x' })).toBe('JD')
  })

  it('keeps an accented initial rather than stripping it', () => {
    expect(initialsOf({ displayName: '\u00c9lodie Sanchez', id: 'x' })).toBe('\u00c9S')
  })

  it('takes two letters of a one-word name, so an initial is never alone', () => {
    expect(initialsOf({ displayName: 'Zelda', id: 'x' })).toBe('ZE')
  })

  // The id is the fallback the design never draws: a person who has written but named nothing.
  it('falls back to the id when the display name is absent or blank', () => {
    expect(initialsOf({ id: 'person-42' })).toBe('PE')
    expect(initialsOf({ displayName: '   ', id: 'person-42' })).toBe('PE')
  })

  it('answers a single letter for a one-character id rather than padding it', () => {
    expect(initialsOf({ id: 'a' })).toBe('A')
  })

  it('renders the initials, hidden from the reading order beside the name', () => {
    render(<Avatar person={{ id: 'p1', displayName: 'Marion Barbier', roles: [], identities: [], reviewed: false }} />)

    const node = screen.getByText('MB')
    expect(node.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('the needs-attention table with nothing to show', () => {
  // §1.7 ships one empty state — a headline and a paragraph. The bordered card with its four
  // column headers over no rows is not it, and the Overview's filter chips reach it.
  it('renders the empty state instead of its own column headers', () => {
    render(<I18nProvider><MemoryRouter><AttentionTable rows={[]} /></MemoryRouter></I18nProvider>)

    expect(screen.getByText('Nothing under this filter')).toBeDefined()
    expect(screen.getByText(/Clear it to see everything/)).toBeDefined()
    expect(screen.queryByText('Reason')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  // Discriminates the empty branch from a table that lost its headers: one row brings them back.
  it('heads the table as soon as it has a row', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <AttentionTable rows={[{ name: 'radarr', state: 'dormant', reason: 'refused' }]} />
        </MemoryRouter>
      </I18nProvider>,
    )

    expect(screen.getByText('Reason')).toBeDefined()
    expect(screen.queryByText('Nothing under this filter')).toBeNull()
  })
})
