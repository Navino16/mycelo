import { afterEach, describe, expect, it, mock } from 'bun:test'
import { ApiError, api, onUnauthenticated, setLocaleHeader } from '../../src/api/client.ts'
import type { ConfigDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** The core's envelope is nested under `error` (api/server.ts:50-59), never flat. */
function refusal(code: string, message: string, detail?: unknown): unknown {
  return { error: { code, message, ...(detail === undefined ? {} : { detail }) } }
}

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = mock(() => Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ))
}

function recorder(): { calls: { url: string, init: RequestInit }[] } {
  const calls: { url: string, init: RequestInit }[] = []
  globalThis.fetch = mock((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
  }) as unknown as typeof fetch
  return { calls }
}

describe('the api client', () => {
  it('sends the locale override header, which is how the two halves of a screen agree', async () => {
    const { calls } = recorder()
    setLocaleHeader('fr')

    await api.get('/api/config')

    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('x-mycelo-locale')).toBe('fr')
  })

  // api/context.ts:73-77 compares the header to availableLocales() with no canonicalization,
  // so an uppercase tag is silently ignored.
  it('lowercases the locale, because the core matches the override exactly', async () => {
    const { calls } = recorder()
    setLocaleHeader('FR')

    await api.get('/api/config')

    expect(new Headers(calls[0]?.init.headers).get('x-mycelo-locale')).toBe('fr')
  })

  it('routes a 401 to login and a 503 setup-required to the wizard, which are different screens', async () => {
    const seen: string[] = []
    onUnauthenticated((kind) => seen.push(kind))

    respondWith(401, refusal('unauthenticated', 'you are not signed in'))
    await api.get('/api/plugins').catch(() => undefined)
    respondWith(503, refusal('setup-required', 'no account exists yet'))
    await api.get('/api/plugins').catch(() => undefined)

    expect(seen).toEqual(['login', 'setup'])
  })

  // routes/auth.ts:101 answers a wrong password with a 401. Routing that to login remounts the
  // screen the operator is already on and clears the message telling them what went wrong.
  it('does not route a 401 from the login route itself, but still rejects', async () => {
    const seen: string[] = []
    onUnauthenticated((kind) => seen.push(kind))

    respondWith(401, refusal('unauthenticated', 'that username and password do not match'))
    const failure = await api.send('POST', '/api/login', { username: 'a', password: 'b' })
      .then(() => null, (e: unknown) => e)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(401)
    expect((failure as ApiError).message).toBe('that username and password do not match')
    expect(seen).toEqual([])
  })

  // A 503 the setup lock did not raise is an ordinary refusal: sending the operator to the
  // wizard would hide it behind a screen that answers nothing.
  it('does not route a 503 that is not setup-required', async () => {
    const seen: string[] = []
    onUnauthenticated((kind) => seen.push(kind))

    respondWith(503, refusal('internal', 'something else'))
    const failure = await api.get('/api/plugins').then(() => null, (e: unknown) => e)

    expect(seen).toEqual([])
    expect((failure as ApiError).status).toBe(503)
  })

  it('carries the server code, message and detail on a refusal, so a form can show what was refused', async () => {
    respondWith(400, refusal('validation', "alias 'x y' is not a name a caller could type", ['alias']))

    const failure = await api.send('PUT', '/api/plugins/a/commands/b/alias', { alias: 'x y' })
      .then(() => null, (e: unknown) => e)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(400)
    expect((failure as ApiError).code).toBe('validation')
    expect((failure as ApiError).message).toBe("alias 'x y' is not a name a caller could type")
    expect((failure as ApiError).detail).toEqual(['alias'])
  })

  it('sends the method and the body it was given', async () => {
    const { calls } = recorder()

    await api.send('PATCH', '/api/people/p1', { displayName: 'Alice' })

    expect(calls[0]?.url).toBe('/api/people/p1')
    expect(calls[0]?.init.method).toBe('PATCH')
    expect(calls[0]?.init.body).toBe('{"displayName":"Alice"}')
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json')
  })

  it('sends no body and no content-type on a GET', async () => {
    const { calls } = recorder()

    await api.get('/api/health')

    expect(calls[0]?.init.method).toBe('GET')
    expect(calls[0]?.init.body).toBeUndefined()
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBeNull()
  })

  // A 204 and a 200 with an empty body both happen on this API; neither is valid JSON.
  it('does not try to parse an empty body', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 })))

    expect(await api.send('DELETE', '/api/people/p1/roles/guest')).toBeUndefined()
  })

  it('parses a body the server did send', async () => {
    respondWith(200, { prefix: '/', defaultLocale: 'en' })

    expect(await api.get<ConfigDto>('/api/config')).toEqual({ prefix: '/', defaultLocale: 'en' })
  })
})
