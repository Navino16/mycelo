import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { FastifyInstance } from 'fastify'
import { boot, closeBooted, freshDir, setup } from './support.js'
import type { Booted } from './support.js'

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
  })

  it('refuses a setup password shorter than 8 characters', async () => {
    // Ruling from task 9's review: the length policy lives in the route schema, as a 400
    // naming the field, not inside createCredential's throw (which would surface as a 500).
    const a = start()
    const response = await a.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'short' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation')
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
    const a = start('owner:\n  channel: console\n  userId: alice\n')
    const cookie = await setup(a)
    const me = (await a.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json<Record<string, unknown>>()
    // spec §6.4: the same principal, so the channel identity is already attached and the
    // owner role comes for free.
    expect(me).toMatchObject({
      roles: ['owner'],
      identities: [{ channel: 'console', externalId: 'alice' }],
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
  })

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
  })
})
