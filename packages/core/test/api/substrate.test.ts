import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined
afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  booted = undefined
})

const PACKAGE_JSON = join(import.meta.dirname, '..', '..', 'package.json')

describe('GET /api/substrate', () => {
  it('answers the core package version, verbatim', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const declared = (JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string }).version

    const body = (await app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie },
    })).json<{ version: string }>()

    expect(body.version).toBe(declared)
  })

  it('answers a start time and a whole-second uptime that grows', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted

    const first = (await app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie },
    })).json<{ startedAt: string, uptimeSeconds: number }>()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const second = (await app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie },
    })).json<{ startedAt: string, uptimeSeconds: number }>()

    expect(Number.isNaN(Date.parse(first.startedAt))).toBe(false)
    // The same boot: startedAt is fixed and only the derived number moves.
    expect(second.startedAt).toBe(first.startedAt)
    expect(second.uptimeSeconds).toBeGreaterThan(first.uptimeSeconds)
  })

  // The uptime rounds down and the start time is this boot's, not a module-load constant:
  // startedAt is pushed 1500 ms into the past, which floor reads as 1 and ceil as 2.
  it('rounds the uptime down from the boot recorded in the runtime state', async () => {
    booted = await bootAndLogin()
    const { app, cookie, served } = booted
    const past = new Date(Date.now() - 1_500)
    ;(served.state as { startedAt: Date }).startedAt = past

    const body = (await app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie },
    })).json<{ startedAt: string, uptimeSeconds: number }>()

    expect(body.uptimeSeconds).toBe(1)
    expect(body.startedAt).toBe(past.toISOString())
  })

  it('answers a start time this boot set, not the epoch', async () => {
    booted = await bootAndLogin()

    const body = (await booted.app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie: booted.cookie },
    })).json<{ startedAt: string }>()

    // A minute is generous for a boot and still refuses a constant far from now.
    expect(Date.now() - Date.parse(body.startedAt)).toBeLessThan(60_000)
  })

  // ISO 8601, not Date.prototype.toString: the SPA parses this and a locale string is not
  // a wire format.
  it('serialises the start time as ISO 8601, round-tripping unchanged', async () => {
    booted = await bootAndLogin()

    const body = (await booted.app.inject({
      method: 'GET', url: '/api/substrate', headers: { cookie: booted.cookie },
    })).json<{ startedAt: string }>()

    expect(new Date(body.startedAt).toISOString()).toBe(body.startedAt)
  })

  it('is refused without a session', async () => {
    booted = await bootAndLogin()

    const answer = await booted.app.inject({ method: 'GET', url: '/api/substrate' })

    expect(answer.statusCode).toBe(401)
  })
})
