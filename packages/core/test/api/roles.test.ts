import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

describe('/api/roles', () => {
  it('refuses to delete the configured default role, through the API', async () => {
    booted = await bootAndLogin({ config: 'defaultRole: guest\n', seedRole: 'guest' })
    const { app, cookie } = booted
    const response = await app.inject({ method: 'DELETE', url: '/api/roles/guest', headers: { cookie } })
    expect(response.statusCode).toBe(400)
    // Boot raises a StartupError for a missing defaultRole, so deleting into that state
    // would leave every first contact throwing until someone restarts and reads why.
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("role 'guest' is the configured default role and cannot be deleted")
    const still = (
      await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } })
    ).json<{ name: string }[]>()
    expect(still.map((r) => r.name)).toContain('guest')
  })

  it('refuses to delete a builtin role', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'DELETE', url: '/api/roles/owner', headers: { cookie } })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("role 'owner' is builtin and cannot be changed")
  })

  it('404s deleting a role that does not exist, naming it', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'DELETE', url: '/api/roles/ghost-role', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('creates a role with several patterns and reads them all back', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie },
      payload: { name: 'guest', patterns: ['media.*', 'admin.whoami'] },
    })
    const roles = (
      await app.inject({ method: 'GET', url: '/api/roles/guest', headers: { cookie } })
    ).json<{ patterns: string[] }>()
    // The plural case: an insert loop that kept only the last pattern would pass with one.
    // Order is alphabetical, not insertion order: listRoles' query is a scan over the
    // (role_id, pattern) primary key, which SQLite answers sorted by pattern.
    expect(roles.patterns).toEqual(['admin.whoami', 'media.*'])
  })

  it('404s reading a role that does not exist', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'GET', url: '/api/roles/ghost-role', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('conflicts creating a role that already exists, naming it', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie }, payload: { name: 'owner', patterns: [] },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("role 'owner' already exists")
  })

  it('refuses duplicate patterns on creation, writing nothing', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie },
      payload: { name: 'guest', patterns: ['media.*', 'media.*'] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('a pattern is listed twice')
    const roles = (
      await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } })
    ).json<{ name: string }[]>()
    expect(roles.map((r) => r.name)).not.toContain('guest')
  })

  it('rewrites a plain role\'s patterns, replacing them wholesale', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie },
      payload: { name: 'guest', patterns: ['media.*'] },
    })
    await app.inject({
      method: 'PUT', url: '/api/roles/guest/commands', headers: { cookie },
      payload: { patterns: ['admin.whoami', 'admin.plugins'] },
    })
    const role = (
      await app.inject({ method: 'GET', url: '/api/roles/guest', headers: { cookie } })
    ).json<{ patterns: string[] }>()
    // The plural case again, on the replace path rather than the create path. Alphabetical
    // for the same reason as the create-path test above.
    expect(role.patterns).toEqual(['admin.plugins', 'admin.whoami'])
  })

  it('refuses to rewrite a builtin role\'s commands', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'PUT', url: '/api/roles/owner/commands', headers: { cookie }, payload: { patterns: ['media.*'] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("role 'owner' is builtin and cannot be changed")
  })

  it('404s rewriting the commands of a role that does not exist', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'PUT', url: '/api/roles/ghost-role/commands', headers: { cookie }, payload: { patterns: [] },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('refuses duplicate patterns on rewrite, leaving the previous set untouched', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie },
      payload: { name: 'guest', patterns: ['media.*'] },
    })
    const response = await app.inject({
      method: 'PUT', url: '/api/roles/guest/commands', headers: { cookie },
      payload: { patterns: ['admin.whoami', 'admin.whoami'] },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('a pattern is listed twice')
    const role = (
      await app.inject({ method: 'GET', url: '/api/roles/guest', headers: { cookie } })
    ).json<{ patterns: string[] }>()
    expect(role.patterns).toEqual(['media.*'])
  })

  it('deletes a plain role, in a different locale', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    await app.inject({
      method: 'POST', url: '/api/roles', headers: { cookie }, payload: { name: 'guest', patterns: [] },
    })
    const response = await app.inject({
      method: 'DELETE', url: '/api/roles/guest', headers: { cookie, 'accept-language': 'fr' },
    })
    expect(response.statusCode).toBe(200)
    const roles = (
      await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } })
    ).json<{ name: string }[]>()
    expect(roles.map((r) => r.name)).not.toContain('guest')
  })

  it('renders the builtin refusal in French, distinctly from the English text', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const en = await app.inject({ method: 'DELETE', url: '/api/roles/owner', headers: { cookie } })
    const fr = await app.inject({
      method: 'DELETE', url: '/api/roles/owner', headers: { cookie, 'accept-language': 'fr' },
    })
    // Asserting one locale alone would pass against a hardcoded string in that language.
    expect(en.json<{ error: { message: string } }>().error.message)
      .toBe("role 'owner' is builtin and cannot be changed")
    expect(fr.json<{ error: { message: string } }>().error.message)
      .toBe('le rôle « owner » est intégré et ne peut pas être modifié')
  })
})
