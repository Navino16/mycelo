import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { recordInstall } from '../../src/config/store.js'
import { bootAndLogin, brokenManifest, closeBooted, cyclingPair, cyclingTriple, unhealthyRhiza } from './support.js'
import type { LoggedIn } from './support.js'
import type { RuntimeHealth } from '../../src/supervision/health.js'
import type { RuntimeHealthDto } from '../../src/api/routes/health.js'

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

  // An absent field and a zero read the same to a client that uses `?? 0`; only this
  // explicit membership check tells the two apart.
  it('carries blockedSinceBoot, zero on a substrate that never refused a message', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json<RuntimeHealth>()
    expect('blockedSinceBoot' in body).toBe(true)
    expect(body.blockedSinceBoot).toBe(0)
  })

  it('reports degraded and names the cycle', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json<RuntimeHealth>()
    expect(body).toMatchObject({ mode: 'degraded', failure: { kind: 'cycle' } })
    expect(body.failure?.kind === 'cycle' ? [...body.failure.spores].sort() : []).toEqual(['alpha', 'beta'])
  })

  // task 13's degraded-mode audit: none of RuntimeHealth's fields are optional on the wire,
  // so the degraded branch must answer each one's empty value rather than omit it.
  it('answers every RuntimeHealth field while degraded, none of them absent', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json<RuntimeHealth>()
    expect(body.dormant).toEqual([])
    expect(body.enforcingBlocked).toEqual([])
    expect(body.rhizas).toEqual([])
    expect(body.blockedSinceBoot).toBe(0)
  })

  // Nothing drove a throwing health() through this route before the whole-branch review:
  // one rejecting rhiza rejected the Promise.all and answered 500, suppressing the very
  // screen that carries enforcingBlocked (spec §11).
  it('reports a rhiza whose health() rejects as unreachable, with 200', async () => {
    booted = await bootAndLogin({ spores: unhealthyRhiza })
    const { app, cookie } = booted
    const response = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    const body = response.json<RuntimeHealth>()
    expect(body.mode).toBe('germinated')
    expect(body.rhizas.map((r) => [r.rhiza, r.status.state, r.status.detail]))
      .toEqual([['flapping', 'unreachable', 'connection refused']])
    expect(typeof body.rhizas[0]?.status.checkedAt).toBe('string')
  })

  it('answers a database-backed route while degraded', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    // This is what makes the remedy reachable at all (spec §4.1).
    expect((await app.inject({ method: 'GET', url: '/api/people', headers: { cookie } })).statusCode).toBe(200)
  })

  it('renders a dormant spore reason in the request locale, and differently in each', async () => {
    booted = await bootAndLogin({ spores: brokenManifest })
    const { app, cookie } = booted
    const en = (await app.inject({
      method: 'GET', url: '/api/health', headers: { cookie, 'accept-language': 'en' },
    })).json<RuntimeHealthDto>()
    const fr = (await app.inject({
      method: 'GET', url: '/api/health', headers: { cookie, 'accept-language': 'fr' },
    })).json<RuntimeHealthDto>()
    const enEntry = en.dormant.find((d) => d.name === 'brokenyaml')
    const frEntry = fr.dormant.find((d) => d.name === 'brokenyaml')
    expect(enEntry?.reason)
      .toBe("invalid manifest at 'septum': Invalid input: expected string, received undefined")
    expect(frEntry?.reason)
      .toBe("manifeste invalide à « septum » : Invalid input: expected string, received undefined")
    // Both locales, not one: a route rendering at the default locale would pass a
    // single-locale assertion and answer English to every reader (design §3).
    expect(frEntry?.reason).not.toBe(enEntry?.reason)
    expect(enEntry?.reasonKey).toBe('refusal.germination.invalidManifest')
    expect(frEntry?.reasonKey).toBe('refusal.germination.invalidManifest')
  })

  // /api/plugins already reports this install row as dormant (config/plugins.ts); before this
  // fix /api/health said nothing, so the pill and the attention panel read a healthy bot.
  it('carries an install row whose directory has gone, same as /api/plugins', async () => {
    booted = await bootAndLogin({
      beforeServe: (db) => { recordInstall(db, 'vanished', 'rhiza', true) },
    })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } }))
      .json<RuntimeHealthDto>()
    expect(body.mode).toBe('germinated')
    const entry = body.dormant.find((d) => d.name === 'vanished')
    expect(entry?.reasonKey).toBe('refusal.plugin.notOnDisk')
  })
})

describe('/api/germination/retry', () => {
  it('refuses with 409 when the runtime is germinated', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'POST', url: '/api/germination/retry', headers: { cookie } })
    expect(response.statusCode).toBe(409)
    const body = response.json<{ error: { code: string, message: string } }>()
    expect(body.error.code).toBe('degraded')
    // The translator falls back to the raw key on a typo or a catalogue mismatch; the
    // suite must render the key, not just check the status, to catch that (review, Important 1).
    expect(body.error.message).toBe('germination can only be retried while the runtime is degraded')
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

  // The retry handler must read the install rows too, not registry.dormant alone: the GET route
  // was given sporesDirs and db for exactly this entry, and a retry answering without them tells
  // an operator the substrate is clean at the one moment they are watching it recover.
  it('carries an install row whose directory has gone, same as the GET route', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, served, cookie } = booted
    expect(served.state.germination.status).toBe('degraded')
    // After boot, not through beforeServe: a pre-existing install row makes this a later boot,
    // which records cyclingPair disabled and germinates cleanly with no cycle to retry.
    recordInstall(served.state.db, 'vanished', 'rhiza', true)
    await app.inject({ method: 'POST', url: '/api/plugins/beta/disable', headers: { cookie } })
    const retry = await app.inject({ method: 'POST', url: '/api/germination/retry', headers: { cookie } })
    const body = retry.json<RuntimeHealthDto>()
    expect(body.mode).toBe('germinated')
    expect(body.dormant.find((d) => d.name === 'vanished')?.reasonKey).toBe('refusal.plugin.notOnDisk')
  })

  // The retry handler builds its own RuntimeHealthDto rather than sharing the GET route's
  // renderer; a copy that skipped rendering would leave this one English-only regardless of
  // the request's locale. Disabling 'beta' also leaves 'alpha' dormant on a second, distinct
  // cause (requiredRhizaMissing) — its own dormancy sentence was covered by nothing before
  // this route rendered it, unlike invalidManifest (germinate.test.ts's five-cause guard).
  it('renders the retry response at the request locale, and every dormancy as a sentence, never as its own dotted key', async () => {
    booted = await bootAndLogin({
      spores: (dir) => { cyclingPair(dir); brokenManifest(dir) },
    })
    const { app, cookie } = booted
    expect(booted.served.state.germination.status).toBe('degraded')
    await app.inject({ method: 'POST', url: '/api/plugins/beta/disable', headers: { cookie } })
    const retry = await app.inject({
      method: 'POST', url: '/api/germination/retry', headers: { cookie, 'accept-language': 'fr' },
    })
    const body = retry.json<RuntimeHealthDto>()
    expect(body.mode).toBe('germinated')
    // The premise: two distinct dormancy causes, or the guard below proves nothing.
    expect(body.dormant.map((d) => d.name).sort()).toEqual(['alpha', 'brokenyaml'])
    for (const entry of body.dormant) expect(entry.reason).not.toMatch(/^refusal\./)

    const brokenyaml = body.dormant.find((d) => d.name === 'brokenyaml')
    expect(brokenyaml?.reason)
      .toBe("manifeste invalide à « septum » : Invalid input: expected string, received undefined")
    expect(brokenyaml?.reasonKey).toBe('refusal.germination.invalidManifest')

    const alpha = body.dormant.find((d) => d.name === 'alpha')
    expect(alpha?.reason).toBe("requiert le rhiza « beta », qui n'est pas installé")
    expect(alpha?.reasonKey).toBe('refusal.germination.requiredRhizaMissing')
  })
})
