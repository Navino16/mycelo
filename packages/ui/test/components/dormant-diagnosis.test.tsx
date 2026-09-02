import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { DormantDiagnosis } from '../../src/components/DormantDiagnosis.tsx'
import { I18nProvider } from '../../src/i18n.tsx'

function renderDiagnosis(reason: string): void {
  render(
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

  it('diagnoses a duplicate spore name', () => {
    renderDiagnosis("name 'help' is already claimed by the spore at 'spores/help' (duplicate at 'spores/help2')")
    expect(screen.getByText('Two plugins declare the same command')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Rename one of the commands' })).toBeDefined()
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
