import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { HealthContext } from '../../src/health.tsx'
import { I18nProvider } from '../../src/i18n.tsx'
import { Layout } from '../../src/shell/Layout.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const HEALTHY: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], blockedSinceBoot: 0,
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

/** Renders the shell at a screen that is not the Overview, and answers with its header. */
async function headerAt(path: string): Promise<HTMLElement> {
  globalThis.fetch = mock((url: string) => {
    if (url === '/api/substrate') {
      return Promise.resolve(json({ version: '0.9.3', startedAt: '2026-01-01', uptimeSeconds: 14 * 86_400 }))
    }
    return Promise.resolve(json({}))
  }) as unknown as typeof fetch

  const { container } = render(
    <I18nProvider>
      <HealthContext value={{ health: HEALTHY, error: false, refresh: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="plugins" element={<h1>Plugins</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </HealthContext>
    </I18nProvider>,
  )
  await screen.findByRole('heading', { name: 'Plugins' })
  const header = container.querySelector('header')
  if (header === null) throw new Error('the shell rendered no header')
  return header
}

describe('the shell header', () => {
  // 1b-plugins-mobile.png draws `Plugins` + an Inoculate button and no version line: the title
  // block 1a has is the Overview's own, so a fixed one here would sit above every screen's <h1>.
  it('puts no substrate title above the screen it frames', async () => {
    const header = await headerAt('/plugins')

    expect(within(header).queryByText('Substrate')).toBeNull()
    expect(screen.queryByText('Substrate')).toBeNull()
  })

  // Scoped to the header on purpose: the same line is the sidebar foot's job, and asserting
  // it is absent from the document would delete the foot instead.
  it('puts no version or uptime line in the header', async () => {
    const header = await headerAt('/plugins')

    expect(within(header).queryByText(/mycelo/)).toBeNull()
    expect(within(header).queryByText(/up 14d/)).toBeNull()
    expect(screen.getByText('mycelo 0.9.3 · up 14d 00h')).toBeDefined()
  })

  // Both desktop renders put the host in the sidebar block only; it was drawn twice.
  it('names the host once, in the sidebar and not in the header', async () => {
    const header = await headerAt('/plugins')

    expect(screen.getAllByText('localhost')).toHaveLength(1)
    expect(screen.getByText('localhost').closest('nav')).not.toBeNull()
    expect(within(header).queryByText('localhost')).toBeNull()
  })

  it('still carries the two chrome controls beside the pill', async () => {
    const header = await headerAt('/plugins')

    expect(within(header).getByLabelText('Language')).toBeDefined()
    expect(within(header).getByRole('button', { name: 'Switch theme' })).toBeDefined()
    expect(within(header).getByRole('status')).toBeDefined()
  })
})

describe('the shell body clears the phone nav bar', () => {
  // Nav is `fixed bottom-0` under md, so without the padding the last row of every screen
  // sits behind it — unreachable on a phone, and invisible in a DOM-only test.
  it('pads the main region below the fixed bar, and drops the padding on desktop', async () => {
    await headerAt('/plugins')
    const main = document.querySelector('main')

    expect(main?.className).toContain('pb-20')
    expect(main?.className).toContain('md:pb-4')
  })
})
