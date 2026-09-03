import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { DemandsList } from '../../src/components/DemandsList.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import type { SporeDemands } from '../../src/api/types.ts'

const DEMANDS: SporeDemands = {
  requires: [
    { targets: ['radarr'], anyOf: false, optional: false, scopes: [] },
    { targets: ['plex', 'jellyfin'], anyOf: true, optional: false, scopes: [] },
    { targets: ['mycelium'], anyOf: false, optional: false, scopes: ['roles.assign', 'people.read'] },
  ],
  scopes: ['roles.assign', 'people.read'],
  externals: ['signal-cli'],
  commands: [{ name: 'watching', capabilities: ['reactions'] }],
}

describe('what a plugin is asking for', () => {
  // The brief's own example of the consent moment.
  it('renders a scope as a sentence, not as its dotted name', () => {
    render(<I18nProvider><DemandsList demands={DEMANDS} /></I18nProvider>)
    expect(screen.getByText(/assign roles to people/i)).toBeDefined()
  })

  it('names every alternative of an any_of group', () => {
    render(<I18nProvider><DemandsList demands={DEMANDS} /></I18nProvider>)
    const text = document.body.textContent ?? ''
    expect(text).toContain('plex')
    expect(text).toContain('jellyfin')
  })

  // externals is what no screen could show before phase 9, and it is the one demand
  // the operator must satisfy outside Mycelo entirely.
  it('names an external dependency', () => {
    render(<I18nProvider><DemandsList demands={DEMANDS} /></I18nProvider>)
    expect(screen.getByText('signal-cli')).toBeDefined()
  })

  it('names a command capability, so a channel that cannot serve it is visible before install', () => {
    render(<I18nProvider><DemandsList demands={DEMANDS} /></I18nProvider>)
    const text = document.body.textContent ?? ''
    expect(text).toContain('watching')
    expect(text).toContain('reactions')
  })

  // Discriminates the `r.optional &&` guard: a required dependency (radarr, optional: false
  // in the fixture) must not be marked optional too.
  it('does not mark a required dependency as optional', () => {
    render(<I18nProvider><DemandsList demands={DEMANDS} /></I18nProvider>)
    expect(screen.queryByText('(optional)')).toBeNull()
  })

  it('falls back to the raw scope name when no sentence exists for it', () => {
    render(
      <I18nProvider>
        <DemandsList
          demands={{ requires: [], scopes: ['not.a.real.scope'], externals: [], commands: [] }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('not.a.real.scope')).toBeDefined()
  })

  it('says the plugin asks for nothing when every list is empty', () => {
    render(
      <I18nProvider>
        <DemandsList demands={{ requires: [], scopes: [], externals: [], commands: [] }} />
      </I18nProvider>,
    )
    expect(screen.getByText('Asks for nothing')).toBeDefined()
    expect(screen.getByText(/declares no dependency/)).toBeDefined()
  })

  // A field that crossed the API boundary malformed must not throw into the route error
  // boundary; the well-formed sections beside it still render.
  it('does not throw on a malformed nested field, and still renders the other sections', () => {
    render(
      <I18nProvider>
        <DemandsList demands={{ ...DEMANDS, requires: null as unknown as SporeDemands['requires'] }} />
      </I18nProvider>,
    )
    expect(screen.getByText(/assign roles to people/i)).toBeDefined()
    expect(screen.getByText('signal-cli')).toBeDefined()
  })
})
