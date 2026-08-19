import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted, cyclingPair, cyclingTriple } from './support.js'
import type { LoggedIn } from './support.js'
import type { RuntimeHealth } from '../../src/supervision/health.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted !== undefined) {
    await closeBooted(booted)
    rmSync(booted.dir, { recursive: true, force: true })
  }
  booted = undefined
})

describe('/api/health', () => {
  it('reports germinated with an empty dormant list on a clean substrate', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json<RuntimeHealth>()
    expect(body).toMatchObject({ mode: 'germinated', dormant: [], enforcingBlocked: [] })
  })

  it('reports degraded and names the cycle', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json<RuntimeHealth>()
    expect(body).toMatchObject({ mode: 'degraded', failure: { kind: 'cycle' } })
    expect(body.failure?.kind === 'cycle' ? [...body.failure.spores].sort() : []).toEqual(['alpha', 'beta'])
  })

  it('answers a database-backed route while degraded', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    // This is what makes the remedy reachable at all (spec §4.1).
    expect((await app.inject({ method: 'GET', url: '/api/people', headers: { cookie } })).statusCode).toBe(200)
  })
})

describe('/api/germination/retry', () => {
  it('refuses with 409 when the runtime is germinated', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'POST', url: '/api/germination/retry', headers: { cookie } })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('degraded')
  })

  it('germinates after the culprit is disabled', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    await app.inject({ method: 'POST', url: '/api/plugins/beta/disable', headers: { cookie } })
    const retry = await app.inject({ method: 'POST', url: '/api/germination/retry', headers: { cookie } })
    expect(retry.statusCode).toBe(200)
    expect(retry.json<RuntimeHealth>()).toMatchObject({ mode: 'germinated' })
  })

  it('stays degraded with the new cause when the retry fails too', async () => {
    booted = await bootAndLogin({ spores: cyclingTriple })
    const { app, cookie } = booted
    await app.inject({ method: 'POST', url: '/api/plugins/gamma/disable', headers: { cookie } })
    const retry = await app.inject({ method: 'POST', url: '/api/germination/retry', headers: { cookie } })
    // alpha and beta still cycle: the operator disabled the wrong one and sees a shorter
    // cycle rather than a success (spec §4.2).
    expect(retry.json<RuntimeHealth>()).toMatchObject({ mode: 'degraded', failure: { kind: 'cycle' } })
  })
})
