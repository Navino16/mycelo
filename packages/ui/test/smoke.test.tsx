import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, mock } from 'bun:test'
import { App } from '../src/App.tsx'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

it('renders the shell, which proves happy-dom is preloaded from bunfig.toml', async () => {
  // AuthGate's '/api/me' and HealthProvider's '/api/health' both fire on mount with no defined
  // ordering between them. Racing a single assertion against both — as this test used to — let
  // it pass locally (the shell won the race) and fail on CI (the crash this exposed won it
  // instead): same commit, same bug, different result (CI run 33601721469). Deferring
  // '/api/health' until after the shell is confirmed up removes that race; the state update it
  // triggers still needs a macrotask to commit (measured: 20 flushed microtasks is not enough,
  // one `setTimeout(0)` reliably is — react-dom's scheduler, not this test, owns that hop), so
  // it is wrapped in act() rather than left to leak a "not wrapped in act" warning.
  let resolveHealth: (response: Response) => void = () => {}
  const health = new Promise<Response>((resolve) => { resolveHealth = resolve })

  globalThis.fetch = mock((url: string) => {
    if (url === '/api/health') return health
    return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
  }) as unknown as typeof fetch

  render(<App />)
  await screen.findByText('Plugins')

  await act(async () => {
    resolveHealth(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  await waitFor(() => { expect(screen.getByText('Plugins')).toBeDefined() })
})
