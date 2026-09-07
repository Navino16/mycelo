import { render, screen } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { MemoryRouter } from 'react-router'
import en from '../../../core/translations/common/en.yaml?raw'
import { BY_KEY, DormantDiagnosis, diagnose } from '../../src/components/DormantDiagnosis.tsx'
import { I18nProvider } from '../../src/i18n.tsx'

function renderDiagnosis(reason: string, reasonKey?: string): RenderResult {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <DormantDiagnosis name="radarr" reason={reason} reasonKey={reasonKey} />
      </MemoryRouter>
    </I18nProvider>,
  )
}

// Classification reads the key alone (plan correction 2): the sentence beside each key below
// is one this project's core actually renders for it, kept for the R3 rendering assertions —
// not consulted by the classifier, which is the whole point of this suite now.
describe('the dormant diagnosis', () => {
  it('diagnoses an incomplete configuration', () => {
    renderDiagnosis('configuration is incomplete: apiKey: field required', 'refusal.config.incomplete')
    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    expect(screen.getByText(/configuration is incomplete/)).toBeDefined()
    const link = screen.getByRole('link', { name: 'Fix its settings' })
    expect(link.getAttribute('href')).toBe('/plugins/radarr/settings')
  })

  // A distinct config cause (config/lifecycle.ts's undeclared-secrets refusal) must land in the
  // same bucket as refusal.config.incomplete — the table's breadth, not one lucky key.
  it('diagnoses an undeclared secret the same as an incomplete configuration', () => {
    renderDiagnosis('configuration declares a secret token the schema does not have', 'refusal.config.undeclaredSecrets')
    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    const link = screen.getByRole('link', { name: 'Fix its settings' })
    expect(link.getAttribute('href')).toBe('/plugins/radarr/settings')
  })

  it('diagnoses a septum version incompatibility', () => {
    renderDiagnosis(
      "spore 'radarr' declares septum '^0.10', which excludes the septum actually running (0.11.0)",
      'refusal.plugin.septumIncompatible',
    )
    expect(screen.getByText('It does not accept this version of the plugin contract')).toBeDefined()
  })

  it('diagnoses a missing dependency', () => {
    renderDiagnosis("requires rhiza 'radarr', which is not installed", 'refusal.germination.requiredRhizaMissing')
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  // germinate.ts:113-114 quote the dependency's own refusal verbatim after the outer cause, so
  // the nested text still contains 'configuration is incomplete'. Ruling F14's regex classifier
  // read the sentence and misclassified this as config; classifying on the key removes the
  // failure mode structurally — the outer key wins whatever the nested cause is, because the
  // nested ref is never consulted.
  it('diagnoses a dependency whose own refusal was a configuration one as a dependency, never as config', () => {
    renderDiagnosis(
      "requires one of rhiza 'jellyfin', 'plex'; 'plex' was chosen and is dormant: "
      + 'configuration is incomplete: url: field required',
      'refusal.germination.anyOfDependencyDormant',
    )
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('diagnoses a single dormant dependency the same way, whatever its nested cause', () => {
    renderDiagnosis(
      "requires rhiza 'radarr', which is dormant: configuration is incomplete: api_key: field required",
      'refusal.germination.dependencyDormant',
    )
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  // anastomoses.ts:124-128's own sentence, in the shape an empty SCOPE_PHASE produces. A
  // scope refusal names no plugin to fix either, and it carries no version word — the fixture
  // that claimed one was invented (review M3).
  it('diagnoses a missing mycelium scope as a dependency', () => {
    renderDiagnosis(
      "requires mycelium scope 'sources.manage', which this core does not mount",
      'refusal.germination.scopeNotMounted',
    )
    expect(screen.getByText('Something it depends on is missing')).toBeDefined()
  })

  it('diagnoses a duplicate spore name', () => {
    renderDiagnosis(
      "name 'help' is already claimed by the spore at 'spores/help' (duplicate at 'spores/help2')",
      'refusal.germination.duplicateName',
    )
    expect(screen.getByText('Two plugins declare the same command')).toBeDefined()
    // The list, not the plugin's own page: the alias control lives on the plugins list, and
    // the collision names two plugins, neither of which is the one to fix on its own.
    expect(screen.getByRole('link', { name: 'Rename one of the commands' }).getAttribute('href'))
      .toBe('/plugins')
  })

  // germination/shape.ts's shape-check reasons carry a key in none of the table's groups. A
  // table keyed on an exact match answers `other` for both an unlisted key and no key at all,
  // which is the right degradation and the one the regexes could not give.
  it('falls back to a generic diagnosis for an unlisted key and for no key at all', () => {
    renderDiagnosis('create() returned undefined, expected an object', 'refusal.germination.createNotObject')
    expect(screen.getByText('It did not start')).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
    expect(diagnose('radarr', undefined).title).toBe('dormant.other')
  })

  it('always shows the raw reason beneath the diagnosis, whatever it matched', () => {
    renderDiagnosis('create() returned undefined, expected an object', 'refusal.germination.createNotObject')
    expect(screen.getByText('create() returned undefined, expected an object')).toBeDefined()
  })

  // Representative coverage of the rest of the table, beyond the buckets already exercised
  // above through a rendered sentence.
  it('maps every remaining key group to its own diagnosis', () => {
    expect(diagnose('p', 'refusal.germination.anyOfNoneInstalled').title).toBe('dormant.dependency')
    expect(diagnose('p', 'refusal.germination.requiredRhizaWrongKind').title).toBe('dormant.dependency')
    expect(diagnose('p', 'refusal.germination.scopeLaterPhase').title).toBe('dormant.dependency')
    expect(diagnose('p', 'refusal.germination.reservedName').title).toBe('dormant.collision')
    expect(diagnose('p', 'refusal.germination.reservedDomain').title).toBe('dormant.collision')
    expect(diagnose('p', 'refusal.config.validationThrew').title).toBe('dormant.config')
    expect(diagnose('p', 'refusal.startup.startFailed').title).toBe('dormant.other')
  })

  it('classifies on the key, so a French sentence reaches the same diagnosis as an English one', () => {
    const en = diagnose('p', 'refusal.config.incomplete')
    const fr = diagnose('p', 'refusal.config.incomplete')
    expect(en).toEqual(fr)
    expect(en.title).toBe('dormant.config')
    // The action is the point: this link is the only repair route the screen offers, and the
    // regex classifier lost it for every locale but English (plan correction 2).
    expect(en.action?.to).toBe('/plugins/p/settings')
  })
})

describe('the dormant diagnosis is not the mute colour', () => {
  // design note 2j: red across the whole UI means the mute bot, and this card painted itself
  // crit — the R1 violation. Both halves are the assertion: `border-warn` alone stays green
  // for a card carrying both.
  it('paints the diagnosis amber', () => {
    const { container } = renderDiagnosis(
      'configuration is incomplete: apiKey: missing required field', 'refusal.config.incomplete',
    )
    const card = container.querySelector('[data-diagnosis]')

    expect(card?.className).toContain('border-warn')
    expect(card?.className).not.toContain('border-crit')
  })

  it('paints its title amber, not crit', () => {
    renderDiagnosis('configuration is incomplete: apiKey: missing required field', 'refusal.config.incomplete')
    const title = screen.getByText('Its configuration was refused')

    expect(title.className).toContain('text-warn')
    expect(title.className).not.toContain('text-crit')
  })

  // design note 1c: "Dormant never appears without a literal cause line next to it." (R3)
  it('renders the literal reason beside the classified title, never the title alone', () => {
    renderDiagnosis('configuration is incomplete: apiKey: missing required field', 'refusal.config.incomplete')

    expect(screen.getByText('Its configuration was refused')).toBeDefined()
    expect(screen.getByText('configuration is incomplete: apiKey: missing required field')).toBeDefined()
  })

  it('still shows the rendered sentence, whatever the classification', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DormantDiagnosis name="p" reason="une phrase française" reasonKey="refusal.germination.rhizaNoApi" />
        </MemoryRouter>
      </I18nProvider>,
    )
    expect(screen.getByText('une phrase française')).toBeTruthy()
  })
})

describe('BY_KEY', () => {
  // The table's keys must exist in the core catalogue, or a typo silently demotes a diagnosis
  // to `other`. A `?raw` import resolves the path from this file's own location through the
  // bundler, unlike a filesystem read: packages/ui has no Bun or Node types to read one with.
  it('names no key the core catalogue does not ship', () => {
    // The YAML is nested, so match the leaf name under its two parents rather than the
    // dotted form, which appears nowhere in the file.
    for (const key of Object.keys(BY_KEY)) {
      expect(en).toContain(`${key.split('.').at(-1) ?? ''}:`)
    }
  })
})
