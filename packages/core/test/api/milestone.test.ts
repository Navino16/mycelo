import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { FIXTURES, boot, closeBooted, cyclingPairWithModules, freshDir } from './support.js'
import type { Booted } from './support.js'
import { SESSION_COOKIE } from '../../src/api/sessions.js'
import { germinatePhase } from '../../src/boot/germinate.js'
import { createLogger } from '../../src/support/logger.js'
import type { PluginGroups } from '../../src/api/routes/plugins.js'
import type { PeoplePage } from '../../src/identity/people.js'
import type { RuntimeHealth } from '../../src/supervision/health.js'

interface ErrorBody { error: { code: string, message: string } }
interface SetupState { required: boolean }
interface Toggled { ok: boolean, restartRequired: boolean }

let booted: Booted | undefined
let dir: string | undefined

afterEach(async () => {
  if (booted !== undefined) await closeBooted(booted)
  booted = undefined
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function names(group: readonly { name: string }[]): string[] {
  return group.map((p) => p.name).sort()
}

/** Closes the running process and boots the same directory again: same database, same account. */
async function restart(home: string, sporesDir: string, previous: Booted): Promise<Booted> {
  await closeBooted(previous)
  const next = boot(home, '', false, sporesDir)
  await germinatePhase(next.served.state, createLogger())
  return next
}

describe('the phase-6 milestone (api-design §15)', () => {
  it('walks every step of §15, restart included', async () => {
    // A writable copy: step 6 drops two spores in, and `fixtures/` is under version control.
    // Its `node_modules/@mycelo/septum` symlinks dangle here and that is harmless — every
    // fixture's septum import is type-only, so Bun strips it before resolution.
    dir = freshDir()
    const sporesDir = join(dir, 'spores')
    cpSync(FIXTURES, sporesDir, { recursive: true })

    booted = boot(dir, '', false, sporesDir)
    await germinatePhase(booted.served.state, createLogger())
    const { app } = booted

    // §15.1 — the wizard is reachable with no account and no session, and says so.
    const before = await app.inject({ method: 'GET', url: '/api/setup' })
    expect(before.statusCode).toBe(200)
    expect(before.json<SetupState>()).toEqual({ required: true })

    // §15.2 — the account is created and the response carries the session.
    const created = await app.inject({
      method: 'POST', url: '/api/setup', payload: { username: 'alice', password: 'correct horse' },
    })
    expect(created.statusCode).toBe(200)
    const session = created.cookies.find((c) => c.name === SESSION_COOKIE)?.value
    expect(session).toBeString()
    const cookie = `${SESSION_COOKIE}=${session ?? ''}`
    expect((await app.inject({ method: 'GET', url: '/api/setup' })).json<SetupState>()).toEqual({ required: false })

    // §15.3 — the same route, twice: refused without the cookie, answered with it.
    const anonymous = await app.inject({ method: 'GET', url: '/api/plugins' })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json<ErrorBody>().error).toMatchObject({
      code: 'unauthenticated', message: 'no valid session',
    })

    const listed = await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    const groups = listed.json<PluginGroups>()
    // One assertion over all five keys, so a spore landing in the wrong group — or going
    // missing — fails here rather than passing a per-group check that never reads it.
    expect({
      hypha: names(groups.hypha), rhiza: names(groups.rhiza), enzyme: names(groups.enzyme),
      inhibitor: names(groups.inhibitor), unknown: names(groups.unknown),
    }).toEqual({
      hypha: ['console'],
      rhiza: ['mock'],
      enzyme: ['admin', 'helpdesk', 'media', 'ping', 'twofile'],
      inhibitor: ['gate'],
      unknown: [],
    })

    // §15.4 — a clean substrate: nothing dormant, no inhibitor refusing everything.
    const health = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
    expect(health.statusCode).toBe(200)
    expect(health.json<RuntimeHealth>()).toMatchObject({
      mode: 'germinated', dormant: [], enforcingBlocked: [],
    })

    // §15.5 — the sentinel page, with no cookie: the shell must load before the login form can.
    const shell = await app.inject({ method: 'GET', url: '/' })
    expect(shell.statusCode).toBe(200)
    expect(shell.headers['content-type']).toContain('text/html')
    expect(shell.body).toContain('Mycelo')

    // §15.6 — two rhizas requiring each other. Dropping the files in takes *two* restarts,
    // not the one §15 assumes: only `syncInstalls` at boot creates an install row (there is
    // no inoculate route before phase 8), and phase 5 records anything a later sync finds as
    // disabled, so the row has to exist before the operator can enable it.
    cyclingPairWithModules(sporesDir)
    booted = await restart(dir, sporesDir, booted)
    const disabledStill = await booted.app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
    expect(disabledStill.json<RuntimeHealth>().mode).toBe('germinated')

    for (const name of ['alpha', 'beta']) {
      const enabled = await booted.app.inject({
        method: 'POST', url: `/api/plugins/${name}/enable`, headers: { cookie },
      })
      expect(enabled.statusCode).toBe(200)
      expect(enabled.json<Toggled>()).toEqual({ ok: true, restartRequired: true })
    }

    booted = await restart(dir, sporesDir, booted)
    const restarted = booted.app

    // §15.7 — the phase. The API is up on a substrate that never germinated, and the
    // session survived the restart, so the operator is not locked out of the remedy.
    const degraded = await restarted.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
    expect(degraded.statusCode).toBe(200)
    const body = degraded.json<RuntimeHealth>()
    expect(body).toMatchObject({ mode: 'degraded', failure: { kind: 'cycle' } })
    expect(body.failure?.kind === 'cycle' ? [...body.failure.spores].sort() : []).toEqual(['alpha', 'beta'])

    const people = await restarted.inject({ method: 'GET', url: '/api/people', headers: { cookie } })
    expect(people.statusCode).toBe(200)
    // Not merely a 200: the owner the wizard created is listed, which is the row every
    // remedy screen reads. An empty page would answer 200 just as happily.
    const page = people.json<PeoplePage>()
    expect(page.total).toBe(1)
    expect(page.items[0]?.roles).toEqual(['owner'])

    // §15.8 — disable one end of the cycle, then retry.
    const disabled = await restarted.inject({
      method: 'POST', url: '/api/plugins/beta/disable', headers: { cookie },
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json<Toggled>()).toEqual({ ok: true, restartRequired: false })

    const retry = await restarted.inject({
      method: 'POST', url: '/api/germination/retry', headers: { cookie },
    })
    expect(retry.statusCode).toBe(200)
    const germinated = retry.json<RuntimeHealth>()
    expect(germinated.mode).toBe('germinated')
    expect(germinated.failure).toBeUndefined()
    // `alpha` survives the retry as dormant, not as a cycle: its mandatory `beta` is gone.
    expect(germinated.dormant.map((d) => d.name)).toEqual(['alpha'])

    // §15.9 — a second retry on a live substrate would tear down what step 8 just started.
    const again = await restarted.inject({
      method: 'POST', url: '/api/germination/retry', headers: { cookie },
    })
    expect(again.statusCode).toBe(409)
    expect(again.json<ErrorBody>().error).toMatchObject({
      code: 'degraded', message: 'germination can only be retried while the runtime is degraded',
    })
  })
})
