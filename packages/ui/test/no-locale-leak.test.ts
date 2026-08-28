import { afterEach, expect, it, mock } from 'bun:test'
import { api, setLocaleHeader } from '../src/api/client.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

// bun:test's file discovery order is not alphabetical or argument order (measured: reversing
// the two files on the command line did not change which ran first), so a literal two-file
// leak cannot be pinned deterministically. This reproduces the exact defect instead: nothing
// but test/setup.ts's preload-level afterEach resets client.ts's module-level locale, so if it
// is missing, this test's own previous sibling test leaves it at 'fr' for this one to inherit.
it('leaves the client at fr for whichever test runs next, if nothing resets it', () => {
  setLocaleHeader('fr')
})

it('does not inherit a locale set by a previous test, in this file or any other', async () => {
  const calls: { init: RequestInit }[] = []
  globalThis.fetch = mock((_url: string, init: RequestInit) => {
    calls.push({ init })
    return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
  }) as unknown as typeof fetch

  await api.get('/api/config')

  expect(new Headers(calls[0]?.init.headers).get('x-mycelo-locale')).toBe('en')
})
