import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { boot, bootAndLogin, closeBooted, freshDir } from './support.js'
import type { Booted, LoggedIn } from './support.js'

let logged: LoggedIn | undefined
let plain: Booted | undefined
let plainDir: string | undefined

afterEach(async () => {
  if (logged !== undefined) {
    await closeBooted(logged)
    rmSync(logged.dir, { recursive: true, force: true })
  }
  logged = undefined
  if (plain !== undefined) await closeBooted(plain)
  plain = undefined
  if (plainDir !== undefined) rmSync(plainDir, { recursive: true, force: true })
  plainDir = undefined
})

describe('the static mount', () => {
  it('serves the sentinel page at the root', async () => {
    logged = await bootAndLogin()
    const { app, cookie } = logged
    const response = await app.inject({ method: 'GET', url: '/', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
  })

  it('falls back to the shell for an unknown non-API path', async () => {
    logged = await bootAndLogin()
    const { app, cookie } = logged
    // An SPA route the server knows nothing about must still load the shell.
    expect((await app.inject({ method: 'GET', url: '/plugins/radarr', headers: { cookie } })).statusCode)
      .toBe(200)
  })

  it('does not shadow /api: an unknown API path is a JSON 404, not the shell', async () => {
    logged = await bootAndLogin()
    const { app, cookie } = logged
    const response = await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
    // The rendered text, not just the code: a typo'd key would fall back silently otherwise.
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no route for '/api/nope'")
  })

  it('does not shadow /healthz', async () => {
    logged = await bootAndLogin()
    const { app } = logged
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json<{ ok: boolean }>()).toEqual({ ok: true })
  })

  it('serves the shell without a session, so the login form can load', async () => {
    logged = await bootAndLogin()
    const { app } = logged
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200)
  })

  it('serves the shell even while setup is required, so the wizard can load', async () => {
    plainDir = freshDir()
    plain = boot(plainDir)
    const { app } = plain
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200)
    // The lock still stands for every /api/ route.
    const refused = await app.inject({ method: 'GET', url: '/api/plugins' })
    expect(refused.statusCode).toBe(503)
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('setup-required')
  })
})
