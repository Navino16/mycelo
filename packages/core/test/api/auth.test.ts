import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { count } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { boot, closeBooted, freshDir, setup } from './support.js'
import type { Booted } from './support.js'
import { channelIdentity, principal, principalRole, uiCredential } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'

let dir: string
let booted: Booted | undefined

beforeEach(() => { dir = freshDir() })
afterEach(async () => {
  if (booted !== undefined) await closeBooted(booted)
  booted = undefined
  rmSync(dir, { recursive: true, force: true })
})

function start(extra = '', trustProxy = false): FastifyInstance {
  booted = boot(dir, extra, trustProxy)
  return booted.app
}

/** Only valid after `start()`: the row-count assertions below need the raw handle. */
function db(): Db {
  if (booted === undefined) throw new Error('start() must run before db()')
  return booted.served.state.db
}

describe('the setup lock', () => {
  it('says setup is required, and refuses every other route with 503', async () => {
    const a = start()
    expect((await a.inject({ method: 'GET', url: '/api/setup' })).json<{ required: boolean }>())
      .toEqual({ required: true })
    // The plural case: a lock keyed on one url would pass a single-route test.
    for (const url of ['/api/health', '/api/plugins', '/api/people', '/api/roles']) {
      const response = await a.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(503)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('setup-required')
    }
  })

  it('locks /api/login too: it needs no session, but it is not the setup route', async () => {
    // Login must never need a session to reach it, but it must not jump the §6.4 queue
    // ahead of the wizard either — a session-exemption is not a setup-exemption.
    const a = start()
    const response = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('setup-required')
  })

  it('leaves /healthz reachable while locked', async () => {
    expect((await start().inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
  })

  it('stops refusing once the account exists', async () => {
    const a = start()
    const cookie = await setup(a)
    expect((await a.inject({ method: 'GET', url: '/api/setup' })).json<{ required: boolean }>())
      .toEqual({ required: false })
    // /api/me and not /api/health: a route this task creates. Asserting 200 on a route
    // that does not exist yet would fail for the wrong reason.
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode)
      .toBe(200)
  })

  it('refuses a second setup with 409', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'bob', password: 'another one' },
    })
    expect(response.statusCode).toBe(409)
    // The one rendering assertion (task 10.5): a key, not a raw sentence, reaches the wire.
    expect(response.json<{ error: { message: string } }>().error.message).toBe('a UI account already exists')
  })

  it('refuses a setup password shorter than 8 characters', async () => {
    // Ruling from task 9's review: the length policy lives in the route schema, as a 400
    // naming the field, not inside the store's own throw (which would surface as a 500).
    const a = start()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'short' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation')
  })

  it('refuses a whitespace-only username with 400, and leaves no principal behind', async () => {
    // Review, Important 2 and 3: the exact repro that used to create an orphan owner
    // principal and answer 409. Zod now rejects it before ownerPrincipal ever runs.
    const a = start()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: '   ', password: 'correct horse' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation')
    expect(db().select({ n: count() }).from(principal).get()?.n).toBe(0)
  })

  it('lets exactly one of two concurrent setups win, with no owner configured', async () => {
    // Review, Critical 1: reproduced with no owner: block — the branch where each request
    // minted its own principal, so the primary key that "guards" per §6.4 never fired.
    const a = start()
    const [r1, r2] = await Promise.all([
      a.inject({
        method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'correct horse' },
      }),
      a.inject({
        method: 'POST', url: '/api/setup', payload: { username: 'attacker', password: 'whatever12' },
      }),
    ])
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409])
    expect(db().select({ n: count() }).from(uiCredential).get()?.n).toBe(1)
    expect(db().select({ n: count() }).from(principal).get()?.n).toBe(1)
    expect(db().select({ n: count() }).from(principalRole).get()?.n).toBe(1)
  })

  it('lets exactly one of two concurrent setups win, with a configured owner', async () => {
    // The PK-collision path the review found already worked (both requests resolve the
    // same principal), kept as a regression guard alongside the branch that did not.
    const a = start('owner:\n  channel: console\n  userId: owner-on-console\n')
    const [r1, r2] = await Promise.all([
      a.inject({
        method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'correct horse' },
      }),
      a.inject({
        method: 'POST', url: '/api/setup', payload: { username: 'attacker', password: 'whatever12' },
      }),
    ])
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409])
    expect(db().select({ n: count() }).from(uiCredential).get()?.n).toBe(1)
  })

  it('answers 500 with code internal for an ownerPrincipal fault, not 409', async () => {
    // Re-review regression: moving ownerPrincipal inside the transaction's try/catch meant
    // its own "core bug" throw was caught by the same catch as the duplicate-setup race and
    // relabelled a client conflict. Reachable if the configured owner's channel_identity row
    // is missing — simulated here directly, since bootstrapIdentity itself never fails to
    // create it.
    const a = start('owner:\n  channel: console\n  userId: owner-on-console\n')
    db().delete(channelIdentity).run()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('internal')
  })

  it('maps a bare ZodError to the §9 validation shape', async () => {
    // Spec gap the review found: setErrorHandler mapped no ZodError. Declared before any
    // request so it lands before the instance starts (Fastify forbids adding routes after).
    const a = start()
    a.get('/test-zod-error', () => { z.object({ x: z.string() }).parse({}) })
    await setup(a)
    const response = await a.inject({ method: 'GET', url: '/test-zod-error' })
    expect(response.statusCode).toBe(400)
    const body = response.json<{ error: { code: string, detail: unknown } }>()
    expect(body.error.code).toBe('validation')
    expect(Array.isArray(body.error.detail)).toBe(true)
  })
})

describe('authentication', () => {
  it('refuses an authenticated route with no cookie', async () => {
    const a = start()
    await setup(a)
    // A real route, so the 401 proves the hook refused rather than the router 404ing.
    // onRequest runs before routing, so a nonexistent url would answer 401 either way.
    const response = await a.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unauthenticated')
  })

  it('refuses a forged cookie', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'GET', url: '/api/me', headers: { cookie: 'mycelo_session=forged' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('logs in, answers /api/me, and logs out', async () => {
    const a = start()
    await setup(a)
    const login = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = `mycelo_session=${login.cookies.find((c) => c.name === 'mycelo_session')?.value ?? ''}`
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(me.json()).toMatchObject({ username: 'alice', roles: ['owner'] })
    expect((await a.inject({ method: 'POST', url: '/api/logout', headers: { cookie } })).statusCode).toBe(200)
    // The session row is gone, so the same cookie is now worthless.
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('refuses a wrong password with 401 and no cookie', async () => {
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.cookies).toHaveLength(0)
  })

  it('binds the account to the configured owner principal', async () => {
    // userId deliberately differs from setup()'s username ('alice'): a route that looked up
    // channel_identity by the submitted username instead of config.owner.userId would pass
    // this test unchanged if the two strings matched (review finding, Important 4).
    const a = start('owner:\n  channel: console\n  userId: owner-on-console\n')
    const cookie = await setup(a)
    const me = (await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json<Record<string, unknown>>()
    // spec §6.4: the same principal, so the channel identity is already attached and the
    // owner role comes for free.
    expect(me).toMatchObject({
      username: 'alice',
      roles: ['owner'],
      identities: [{ channel: 'console', externalId: 'owner-on-console' }],
    })
  })

  it('creates a fresh owner principal when no owner is configured', async () => {
    const a = start()
    const cookie = await setup(a)
    const me = (await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json<Record<string, unknown>>()
    expect(me).toMatchObject({ roles: ['owner'], identities: [] })
  })

  it('changes the password only with the current one', async () => {
    const a = start()
    const cookie = await setup(a)
    expect((await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie },
      payload: { current: 'wrong', next: 'a new password' },
    })).statusCode).toBe(400)
    expect((await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie },
      payload: { current: 'correct horse', next: 'a new password' },
    })).statusCode).toBe(200)
  })

  it('refuses a new password shorter than 8 characters', async () => {
    const a = start()
    const cookie = await setup(a)
    const response = await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie },
      payload: { current: 'correct horse', next: 'short' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('answers 500 with code internal for a changePassword failure other than a wrong password', async () => {
    // Re-review, step 3: the narrowed catch's `throw e` branch had no test proving the new
    // status code. Reachable if the credential row's principal no longer matches the live
    // session's — reassigned rather than deleted, so hasCredential() stays true and the
    // setup lock does not intercept the request before it reaches the route.
    const a = start()
    const cookie = await setup(a)
    const other = crypto.randomUUID()
    db().insert(principal).values({ id: other, createdAt: new Date() }).run()
    db().update(uiCredential).set({ principalId: other }).run()
    const response = await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie },
      payload: { current: 'correct horse', next: 'a new password' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('internal')
  })

  it('invalidates every other session on a password change, but keeps the current one', async () => {
    // Ruling from task 9's review: a stolen cookie must not survive the fix, and the
    // person who just changed it must not be logged out of their own browser.
    const a = start()
    const sessionA = await setup(a)
    const login = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'correct horse' },
    })
    const sessionB = `mycelo_session=${login.cookies.find((c) => c.name === 'mycelo_session')?.value ?? ''}`
    expect(sessionA).not.toBe(sessionB)
    const change = await a.inject({
      method: 'PUT', url: '/api/me/password', headers: { cookie: sessionB },
      payload: { current: 'correct horse', next: 'a new password' },
    })
    expect(change.statusCode).toBe(200)
    // Session A never touched the change and is now dead.
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionA } })).statusCode)
      .toBe(401)
    // Session B performed the change and stays alive.
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: { cookie: sessionB } })).statusCode)
      .toBe(200)
  })
})

// The first test here spends ten argon2id verifications and the second eleven — ten wrong
// logins from one address, an eleventh the limiter refuses without hashing, then one correct
// login from another. At m=65536 that is ~1.5 s idle and the 5 s default times out on a
// loaded shared runner. The assertions are on status codes, so a larger budget cannot mask
// a logic defect.
const RATE_LIMIT_TIMEOUT_MS = 20_000

describe('rate limiting on login', () => {
  it('limits repeated failed logins and refuses the 11th with 429', async () => {
    const a = start()
    await setup(a)
    let last
    for (let i = 0; i < 11; i += 1) {
      last = await a.inject({
        method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
      })
    }
    expect(last?.statusCode).toBe(429)
    // §9's envelope is what the UI branches on: `internal` here would style a limiter
    // refusal as a server fault (campaign M73).
    expect(last?.json<{ error: { code: string } }>().error.code).toBe('rate-limited')
  }, RATE_LIMIT_TIMEOUT_MS)

  it('counts attempts per client address, and only trusts X-Forwarded-For when told to', async () => {
    // spec §6.7's trap: with trustProxy on, two distinct forwarded addresses are two
    // distinct clients, so exhausting one's limit must not touch the other.
    const a = start('', true)
    await setup(a)
    for (let i = 0; i < 10; i += 1) {
      await a.inject({
        method: 'POST', url: '/api/login',
        payload: { username: 'alice', password: 'wrong' },
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
    }
    const blocked = await a.inject({
      method: 'POST', url: '/api/login',
      payload: { username: 'alice', password: 'wrong' },
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(blocked.statusCode).toBe(429)
    const fromElsewhere = await a.inject({
      method: 'POST', url: '/api/login',
      payload: { username: 'alice', password: 'correct horse' },
      headers: { 'x-forwarded-for': '10.0.0.2' },
    })
    expect(fromElsewhere.statusCode).toBe(200)
  }, RATE_LIMIT_TIMEOUT_MS)

  // `global: false` (spec §6.7) is what keeps the UI's own polling out of the limiter, and
  // it cannot be proved by exhausting a route — @fastify/rate-limit's default max is 1000.
  // A limited route carries `x-ratelimit-limit`; an unlimited one carries none (campaign M74).
  it('limits only /api/login: no other route carries a rate-limit header', async () => {
    const a = start()
    const cookie = await setup(a)
    const login = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
    })
    expect(login.headers['x-ratelimit-limit']).toBe('10')
    // The plural case: a global limiter would stamp every one of these.
    for (const url of ['/api/health', '/api/me', '/api/plugins', '/api/roles']) {
      const response = await a.inject({ method: 'GET', url, headers: { cookie } })
      expect(response.headers['x-ratelimit-limit']).toBeUndefined()
    }
  }, RATE_LIMIT_TIMEOUT_MS)
})

// Not one test asserted a single cookie attribute before this: httpOnly, sameSite and the
// secure flag could each be inverted with the whole suite green (campaign M67-M69), and the
// inverted secure flag alone means a browser silently discards the cookie over plain HTTP.
describe('the session cookie', () => {
  it('is httpOnly, lax, rooted at /, insecure over http, and lasts 14 days', async () => {
    const a = start()
    await setup(a)
    const login = await a.inject({
      method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = login.cookies.find((c) => c.name === 'mycelo_session')
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      // inject() speaks http, and a `secure` cookie over http is one the browser drops.
      maxAge: 14 * 24 * 60 * 60,
    })
    expect(cookie?.secure).toBeUndefined()
  })
})
