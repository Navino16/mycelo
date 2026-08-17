import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { boot, closeBooted, freshDir, setup } from './support.js'
import type { Booted } from './support.js'
import type { RuntimeState } from '../../src/boot/state.js'
import { ApiError } from '../../src/api/errors.js'
import { parseQuery } from '../../src/api/parse.js'
import { channelIdentity, principal } from '../../src/persistence/schema.js'

let dir: string
let booted: Booted | undefined

beforeEach(() => { dir = freshDir() })
afterEach(async () => {
  if (booted !== undefined) await closeBooted(booted)
  booted = undefined
  rmSync(dir, { recursive: true, force: true })
})

function start(extra = ''): FastifyInstance {
  booted = boot(dir, extra)
  return booted.app
}

/** Only valid after `start()`. */
function state(): RuntimeState {
  if (booted === undefined) throw new Error('start() must run before state()')
  return booted.served.state
}

describe('API messages rendered through the translator', () => {
  it('renders a refusal in the reader locale from Accept-Language', async () => {
    // A 401 is reachable before any principal exists, so the header is the only rung
    // resolveApiLocale has — which is exactly the pre-login case.
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('aucune session valide')
  })

  it('renders the same refusal differently in two locales', async () => {
    // The assertion is that the two bodies DIFFER and each matches its own catalogue.
    // Asserting one locale alone passes against a hardcoded string in that language.
    const a = start()
    await setup(a)
    const en = await a.inject({ method: 'GET', url: '/api/me', headers: { 'accept-language': 'en' } })
    const fr = await a.inject({ method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' } })
    const enMessage = en.json<{ error: { message: string } }>().error.message
    const frMessage = fr.json<{ error: { message: string } }>().error.message
    expect(enMessage).toBe('no valid session')
    expect(frMessage).toBe('aucune session valide')
    expect(enMessage).not.toBe(frMessage)
  })

  it('renders the setup lock refusal, which is emitted before the session gate', async () => {
    // The lock's 503 is the message that would have rendered with locale undefined.
    const a = start()
    const response = await a.inject({
      method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("aucun compte n'existe encore ; créez-en un sur /api/setup")
  })
})

/**
 * Review, Important 2: the translator warns and falls back to the key rather than throwing,
 * so a typo'd key name renders a literal `api.someKey` into the response with every status
 * code still correct — invisible to every test above, which only checks status/code. Every
 * key `errors.ts`'s helpers can produce is rendered here against its exact `en` catalogue text.
 */
describe('every api.* key renders its own catalogue text, not a fallback key', () => {
  it('api.setupRequired — the setup lock, before any account exists', async () => {
    const a = start()
    const response = await a.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(503)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe('no UI account exists yet; create one at /api/setup')
  })

  it('api.unauthenticated — no session cookie on a route that needs one', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('no valid session')
  })

  it('api.setupConflict — a second /api/setup after the wizard already ran', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'bob', password: 'another one' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('a UI account already exists')
  })

  it('api.loginFailed — a wrong password', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('wrong username or password')
  })

  it('api.meMissing — a session valid but the principal it names is gone', async () => {
    const a = start()
    const cookie = await setup(a)
    const db = state().db
    const id = db.select({ id: principal.id }).from(principal).get()?.id
    if (id === undefined) throw new Error('setup() did not create a principal')
    // The schema's FK enforces cascade delete, so a live session can never point at a
    // missing principal through normal operation — simulated here, not reproduced.
    db.run(sql`PRAGMA foreign_keys = OFF`)
    db.delete(principal).where(eq(principal.id, id)).run()
    db.run(sql`PRAGMA foreign_keys = ON`)
    const response = await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe('the session principal no longer exists')
  })

  it('api.wrongPassword — the current password does not match', async () => {
    const a = start()
    const cookie = await setup(a)
    const response = await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie },
      payload: { current: 'wrong', next: 'a new password' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('the current password is wrong')
  })

  it('api.invalidBody — a setup payload the schema rejects', async () => {
    const a = start()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'short' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('the request body is invalid')
  })

  it('api.invalidQuery — rendered directly, since no route calls parseQuery yet', () => {
    // parseQuery has no reachable HTTP route (pre-existing, not introduced by this task),
    // so this proves the key/catalogue correspondence at the same rendering call the HTTP
    // cases above use, without a route to carry it.
    start()
    let caught: unknown
    try { parseQuery(z.object({ x: z.string() }), {}) } catch (e) { caught = e }
    if (!(caught instanceof ApiError)) throw new Error('expected parseQuery to throw an ApiError')
    const rendered = state().translator.translate('core', caught.key, 'en', caught.params)
    expect(rendered).toBe('the query string is invalid')
  })

  it("api.invalidRequest — a bare ZodError setErrorHandler's own fallback catches", async () => {
    // Declared before any request so it lands before the instance starts (Fastify forbids
    // adding routes after) — same technique as auth.test.ts's equivalent test.
    const a = start()
    a.get('/test-zod-error', () => { z.object({ x: z.string() }).parse({}) })
    await setup(a)
    const response = await a.inject({ method: 'GET', url: '/test-zod-error' })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('the request is invalid')
  })

  it('api.rateLimited — the 11th failed login within the window', async () => {
    const a = start()
    await setup(a)
    let last
    for (let i = 0; i < 11; i += 1) {
      last = await a.inject({
        method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
      })
    }
    expect(last?.statusCode).toBe(429)
    expect(last?.json<{ error: { message: string } }>().error.message).toBe('too many requests; try again later')
  })

  it('api.internalError — an ownerPrincipal fault, never the raw invariant message', async () => {
    const a = start('owner:\n  channel: console\n  userId: owner-on-console\n')
    state().db.delete(channelIdentity).run()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('an internal error occurred')
  })
})
