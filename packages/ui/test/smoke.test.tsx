import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, mock } from 'bun:test'
import { App } from '../src/App.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

it('renders the shell, which proves happy-dom is preloaded from bunfig.toml', async () => {
  // AuthGate paints nothing until /api/me answers; a stubbed session lets it through to the router.
  globalThis.fetch = mock(() => Promise.resolve(new Response('{}', {
    headers: { 'content-type': 'application/json' },
  })))

  render(<App />)
  await screen.findByText('Plugins')
  expect(screen.getByText('Plugins')).toBeDefined()
})
