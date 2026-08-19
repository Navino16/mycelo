import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { boot, bootAndLogin, closeBooted, freshDir } from './support.js'
import type { Booted, LoggedIn } from './support.js'

let logged: LoggedIn | undefined
let plain: Booted | undefined
let plainDir: string | undefined
let extraDirs: string[] = []

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
  for (const dir of extraDirs) rmSync(dir, { recursive: true, force: true })
  extraDirs = []
})

function uiRoot(marker: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mycelo-ui-root-'))
  extraDirs.push(dir)
  writeFileSync(join(dir, 'index.html'), `<!doctype html><p>${marker}</p>`, 'utf8')
  return dir
}

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

  it('leaves GET /healthz answering as before (does not prove the guard: a real route never reaches it)', async () => {
    logged = await bootAndLogin()
    const { app } = logged
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json<{ ok: boolean }>()).toEqual({ ok: true })
  })

  it('does not shadow /healthz for a method with no route: a JSON 404, not the shell', async () => {
    // GET /healthz is a real route and never reaches the not-found handler at all, so only
    // an unmatched method actually exercises the `path === '/healthz'` guard there.
    logged = await bootAndLogin()
    const { app } = logged
    const response = await app.inject({ method: 'PUT', url: '/healthz' })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
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

describe('UI_ROOTS fallback order', () => {
  it('serves the first root when the file exists in both', async () => {
    const first = uiRoot('first')
    const second = uiRoot('second')
    plainDir = freshDir()
    plain = boot(plainDir, '', false, './none', undefined, [first, second])
    const response = await plain.app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('first')
    expect(response.body).not.toContain('second')
  })

  it('falls through to the second root when the first does not exist', async () => {
    const missing = join(tmpdir(), 'mycelo-ui-root-does-not-exist')
    const second = uiRoot('second')
    plainDir = freshDir()
    plain = boot(plainDir, '', false, './none', undefined, [missing, second])
    const response = await plain.app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('second')
  })
})
