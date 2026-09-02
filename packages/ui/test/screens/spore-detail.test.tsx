import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { SporeDetail } from '../../src/screens/SporeDetail.tsx'
import type { InoculateOutcome, SourceDto, SporeStrainsDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const STRAINS: SporeStrainsDto = {
  strains: ['1.2.0', '1.1.0'],
  detail: {
    name: 'radarr',
    kind: 'rhiza',
    description: 'A movie library',
    septum: '^0.11',
    demands: { requires: [], scopes: ['plugins.configure'], externals: [], commands: [] },
  },
}
const OFFICIAL: SourceDto = {
  id: 1, label: 'Official registry', driver: 'github', location: 'https://github.com/x/y', official: true, enabled: true,
}
const THIRD_PARTY: SourceDto = {
  id: 2, label: 'My mirror', driver: 'github', location: 'https://github.com/a/b', official: false, enabled: true,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve(source: SourceDto, opts?: { strainsFail?: boolean, sourceFail?: boolean }): void {
  globalThis.fetch = mock((url: string) => {
    if (/\/spores\//.test(url)) {
      return opts?.strainsFail === true
        ? Promise.resolve(json({ error: { message: 'x' } }, 500))
        : Promise.resolve(json(STRAINS))
    }
    return opts?.sourceFail === true
      ? Promise.resolve(json({ error: { message: 'x' } }, 500))
      : Promise.resolve(json(source))
  }) as unknown as typeof fetch
}

function renderDetail(): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/sources/2/spores/radarr']}>
        <Routes><Route path="/sources/:id/spores/:name" element={<SporeDetail />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('the spore detail screen', () => {
  it('says something went wrong when both fetches fail, rather than staying blank', async () => {
    serve(THIRD_PARTY, { strainsFail: true, sourceFail: true })
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the spore on success, with no error banner', async () => {
    serve(THIRD_PARTY)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.getByText('A movie library')).toBeDefined()
    expect(screen.getByText('Wants plugin contract ^0.11')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the trust warning for a third-party source', async () => {
    serve(THIRD_PARTY)
    renderDetail()

    expect(await screen.findByRole('note')).toBeDefined()
  })

  it('shows no trust warning for the official source', async () => {
    serve(OFFICIAL)
    renderDetail()

    await waitFor(() => { expect(screen.getByText('radarr')).toBeDefined() })
    expect(screen.queryByRole('note')).toBeNull()
  })

  // phase 8B measured a mutant that dropped every warning but the first: assert both.
  it('renders every warning the install returns, not just the first', async () => {
    serve(THIRD_PARTY)
    renderDetail()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Install' })).toBeDefined() })

    const outcome: InoculateOutcome = {
      name: 'radarr',
      strain: '1.2.0',
      warnings: [
        'this is not the official sporangium: its spores are not code-reviewed',
        'a restart is required for this to take effect',
      ],
      restartRequired: true,
    }
    globalThis.fetch = mock(() => Promise.resolve(json(outcome)))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() => { expect(screen.getByText('Installed as 1.2.0')).toBeDefined() })
    expect(screen.getByText('this is not the official sporangium: its spores are not code-reviewed')).toBeDefined()
    expect(screen.getByText('a restart is required for this to take effect')).toBeDefined()
  })

  it('shows the server refusal in its own alert when the install itself is refused', async () => {
    serve(THIRD_PARTY)
    renderDetail()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Install' })).toBeDefined() })

    globalThis.fetch = mock(() => Promise.resolve(
      json({ error: { message: "'radarr' is already installed" } }, 400),
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("'radarr' is already installed")
  })
})
