import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted, eitherOrSchema } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined
afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  booted = undefined
})

describe('GET /api/config', () => {
  it('carries the prefix, the default locale and the default role', async () => {
    booted = await bootAndLogin({
      config: 'prefix: "!"\ndefaultLocale: fr\ndefaultRole: guest\n', seedRole: 'guest',
    })
    const { app, cookie } = booted

    const body = (await app.inject({
      method: 'GET', url: '/api/config', headers: { cookie },
    })).json<Record<string, unknown>>()

    expect(body).toEqual({ prefix: '!', defaultLocale: 'fr', defaultRole: 'guest' })
  })

  it('omits defaultRole entirely when mycelo.yaml sets none', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted

    const body = (await app.inject({
      method: 'GET', url: '/api/config', headers: { cookie },
    })).json<Record<string, unknown>>()

    expect(body).toEqual({ prefix: '/', defaultLocale: 'en' })
    expect('defaultRole' in body).toBe(false)
  })

  // spec §10 forbids an absolute path in anything a client sees, and this route reads the
  // one config object that holds four of them. `spores` is what puts the resolved root under
  // `dir`: without it bootAndLogin uses FIXTURES, which no assertion here would notice.
  it('answers no filesystem path', async () => {
    booted = await bootAndLogin({ spores: eitherOrSchema })
    const { app, cookie, dir } = booted

    const raw = (await app.inject({
      method: 'GET', url: '/api/config', headers: { cookie },
    })).body

    expect(raw).not.toContain(dir)
    expect(raw).not.toContain('.db')
  })

  it('is refused without a session', async () => {
    booted = await bootAndLogin()

    const answer = await booted.app.inject({ method: 'GET', url: '/api/config' })

    expect(answer.statusCode).toBe(401)
  })
})
