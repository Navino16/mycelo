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

  it('is refused without a session', async () => {
    booted = await bootAndLogin()

    const answer = await booted.app.inject({ method: 'GET', url: '/api/substrate' })

    expect(answer.statusCode).toBe(401)
  })
})
