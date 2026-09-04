import { render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { DormantDiagnosis } from '../../src/components/DormantDiagnosis.tsx'
import { I18nProvider } from '../../src/i18n.tsx'

function renderDiagnosis(reason: string): RenderResult {
  return render(
    <I18nProvider>
      <MemoryRouter><DormantDiagnosis name="radarr" reason={reason} /></MemoryRouter>
    </I18nProvider>,
  )
}

// Every reason below is a real message this project's core produces (germination/germinate.ts,
// germination/anastomoses.ts, @mycelo/septum's compat.ts, germination/shape.ts) — not a
// paraphrase, so a regex drifting from the actual wording turns the matching test red.
describe('the dormant diagnosis', () => {
  it('diagnoses a refused configuration', () => {
    renderDiagnosis('configuration rejected: apiKey: Invalid input: expected string, received undefined')
    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    expect(screen.getByText(/configuration rejected/)).toBeDefined()
    const link = screen.getByRole('link', { name: 'Fix its settings' })
    expect(link.getAttribute('href')).toBe('/plugins/radarr/settings')
  })

  // config/lifecycle.ts:105 produces this exact reason for a schema-rejected config that is
  // merely incomplete, distinct from 'configuration rejected' — both must reach dormant.config.
  it('diagnoses an incomplete configuration the same as a rejected one', () => {
    renderDiagnosis('configuration is incomplete: token: field required')
    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    const link = screen.getByRole('link', { name: 'Fix its settings' })
    expect(link.getAttribute('href')).toBe('/plugins/radarr/settings')
  })

  it('diagnoses a septum version incompatibility', () => {
    renderDiagnosis("spore 'radarr' declares septum '^0.10', which excludes the septum actually running (0.11.0)")
    expect(screen.getByText('It does not accept this version of the plugin contract')).toBeDefined()
  })

  it('diagnoses a missing dependency', () => {
    renderDiagnosis("requires rhiza 'radarr', which is not installed")
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  // germinate.ts:113-114 quote the dependency's own refusal verbatim after the outer cause, so
  // the nested text contains 'configuration rejected'. Classification is on the prefix (ruling
  // F14): every shipped fixture used a short unnested reason, which is why no gate caught it.
  it('diagnoses a dependency whose own refusal was a configuration one as a dependency', () => {
    renderDiagnosis(
      "requires one of rhiza 'jellyfin', 'plex'; 'plex' was chosen and is dormant: "
      + 'configuration rejected: url: Invalid input: expected string, received undefined',
    )
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('diagnoses a single dormant dependency the same way, whatever its nested cause', () => {
    renderDiagnosis(
      "requires rhiza 'radarr', which is dormant: configuration is incomplete: api_key: field required",
    )
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  // anastomoses.ts:124-128's own sentence, in the shape an empty SCOPE_PHASE produces. A
  // scope refusal names no plugin to fix either, and it carries no version word — the fixture
  // that claimed one was invented (review M3).
  it('diagnoses a missing mycelium scope as a dependency', () => {
    renderDiagnosis("requires mycelium scope 'sources.manage', which this core does not mount")
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  it('diagnoses a duplicate spore name', () => {
    renderDiagnosis("name 'help' is already claimed by the spore at 'spores/help' (duplicate at 'spores/help2')")
    expect(screen.getByText('Two plugins declare the same command')).toBeDefined()
    // The list, not the plugin's own page: the alias control lives on the plugins list, and
    // the collision names two plugins, neither of which is the one to fix on its own.
    expect(screen.getByRole('link', { name: 'Rename one of the commands' }).getAttribute('href'))
      .toBe('/plugins')
  })

  // germination/shape.ts's shape-check reasons match none of the named causes.
  it('falls back to a generic diagnosis for an unmatched reason', () => {
    renderDiagnosis('create() returned undefined, expected an object')
    expect(screen.getByText('It did not start')).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('always shows the raw reason beneath the diagnosis, whatever it matched', () => {
    renderDiagnosis('create() returned undefined, expected an object')
    expect(screen.getByText('create() returned undefined, expected an object')).toBeDefined()
  })
})

describe('the dormant diagnosis is not the mute colour', () => {
  // design note 2j: red across the whole UI means the mute bot, and this card painted itself
  // crit — the R1 violation. Both halves are the assertion: `border-warn` alone stays green
  // for a card carrying both.
  it('paints the diagnosis amber', () => {
    const { container } = renderDiagnosis('configuration rejected: apiKey: missing required field')
    const card = container.querySelector('[data-diagnosis]')

    expect(card?.className).toContain('border-warn')
    expect(card?.className).not.toContain('border-crit')
  })

  it('paints its title amber, not crit', () => {
    renderDiagnosis('configuration rejected: apiKey: missing required field')
    const title = screen.getByText('Its configuration was refused')

    expect(title.className).toContain('text-warn')
    expect(title.className).not.toContain('text-crit')
  })

  // design note 1c: "Dormant never appears without a literal cause line next to it." (R3)
  it('renders the literal reason beside the classified title, never the title alone', () => {
    renderDiagnosis('configuration rejected: apiKey: missing required field')

    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    expect(screen.getByText('configuration rejected: apiKey: missing required field')).toBeDefined()
  })
})
