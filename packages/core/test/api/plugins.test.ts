import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { writeSetting } from '../../src/config/store.js'
import { pluginSetting } from '../../src/persistence/schema.js'
import type { PluginDto } from '../../src/api/routes/plugins.js'
import {
  bootAndLogin, closeBooted, configurable, configurableTwoFields, cyclingPair,
} from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

describe('/api/plugins', () => {
  it('carries the install row enabled flag, not only the germination state', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    await app.inject({ method: 'POST', url: '/api/plugins/ping/disable', headers: { cookie } })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginDto[]>()
    const ping = body.find((p) => p.name === 'ping')
    // septum's own doc comment: disable() is reflected only by the next germination, so
    // the two disagree here on purpose. Phase 5's blocker was reporting only one of them.
    expect(ping).toMatchObject({ state: 'germinated', enabled: false })
  })

  it('reports unknown, never dormant, for every plugin while degraded', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    expect(booted.served.state.germination.status).toBe('degraded')
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginDto[]>()
    // Reporting them dormant would send the operator hunting two faults when there is one.
    expect(body.map((p) => p.state)).toEqual(['unknown', 'unknown'])
  })

  it('redacts a secret on read and keeps it secret on write', async () => {
    booted = await bootAndLogin({ spores: configurable })
    const { app, served, cookie } = booted
    // Nothing in this phase can mark a *new* setting secret (config/plugins.ts's own
    // comment); the property under test is that an update carries an existing flag
    // forward, so it is seeded directly, as phase 5's own regression test did.
    writeSetting(served.state.db, 'needs-config', 'token', 'old-secret', true)
    await app.inject({
      method: 'PUT', url: '/api/plugins/needs-config/settings', headers: { cookie },
      payload: { token: 'hunter2' },
    })
    const body = (await app.inject({
      method: 'GET', url: '/api/plugins/needs-config/settings', headers: { cookie },
    })).json<Record<string, string>>()
    expect(body).toEqual({ token: '••••' })
  })

  it('refuses enable by naming every missing field, not just the first', async () => {
    booted = await bootAndLogin({ spores: configurableTwoFields })
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'POST', url: '/api/plugins/needs-config/enable', headers: { cookie },
    })
    expect(response.statusCode).toBe(400)
    const detail = JSON.stringify(response.json())
    // The plural case: an error built from issues[0] would pass a one-field fixture.
    expect(detail).toContain('url')
    expect(detail).toContain('token')
  })

  it('serves a JSON Schema a form generator can use', async () => {
    booted = await bootAndLogin({ spores: configurable })
    const { app, cookie } = booted
    const body = (await app.inject({
      method: 'GET', url: '/api/plugins/needs-config/schema', headers: { cookie },
    })).json<{ available: boolean }>()
    expect(body).toMatchObject({ available: true })
  })

  it('404s on a plugin that is not installed', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ghost', headers: { cookie } })).statusCode)
      .toBe(404)
  })

  it('404s on enable, disable, schema and settings for a plugin that is not installed', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const requests = [
      { method: 'POST' as const, url: '/api/plugins/ghost/enable' },
      { method: 'POST' as const, url: '/api/plugins/ghost/disable' },
      { method: 'GET' as const, url: '/api/plugins/ghost/schema' },
      { method: 'GET' as const, url: '/api/plugins/ghost/settings' },
      { method: 'PUT' as const, url: '/api/plugins/ghost/settings', payload: {} },
    ]
    for (const request of requests) {
      const response = await app.inject({ ...request, headers: { cookie } })
      expect(response.statusCode).toBe(404)
    }
  })

  it('refuses an undeclared setting by naming every offending key, writing none of them', async () => {
    booted = await bootAndLogin({ spores: configurableTwoFields })
    const { app, served, cookie } = booted
    const response = await app.inject({
      method: 'PUT', url: '/api/plugins/needs-config/settings', headers: { cookie },
      payload: { url: 'http://example', bogus: 'x', alsoBogus: 'y' },
    })
    expect(response.statusCode).toBe(400)
    const detail = JSON.stringify(response.json())
    expect(detail).toContain('bogus')
    expect(detail).toContain('alsoBogus')
    // The whole write is refused: a partial write would leave 'url' recorded.
    expect(served.state.db.select().from(pluginSetting).all()).toEqual([])
  })

  it('says a restart is required once germinated, and not while still degraded', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const germinated = await app.inject({ method: 'POST', url: '/api/plugins/ping/disable', headers: { cookie } })
    expect(germinated.json<{ restartRequired: boolean }>().restartRequired).toBe(true)
    await closeBooted(booted)
    rmSync(booted.dir, { recursive: true, force: true })

    booted = await bootAndLogin({ spores: cyclingPair })
    const degraded = await booted.app.inject({
      method: 'POST', url: '/api/plugins/alpha/disable', headers: { cookie: booted.cookie },
    })
    // Nothing is running yet, so a retry — not a process restart — is what applies it.
    expect(degraded.json<{ restartRequired: boolean }>().restartRequired).toBe(false)
  })

  it('rolls back the whole write when the database itself fails partway through', async () => {
    booted = await bootAndLogin({ spores: configurableTwoFields })
    const { app, served, cookie } = booted
    // Same injection technique as config/lifecycle.test.ts's `failingAfter`: 'url''s
    // insert genuinely runs, then 'token''s throws. Proves db.transaction(), not a bare
    // loop, is what makes the pair atomic.
    let inserts = 0
    const db = served.state.db
    const failingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          inserts += 1
          if (inserts > 1) return () => { throw new Error('write failed mid-transaction') }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    Object.assign(served.state, { db: failingDb })
    const response = await app.inject({
      method: 'PUT', url: '/api/plugins/needs-config/settings', headers: { cookie },
      payload: { url: 'http://example', token: 'abc' },
    })
    expect(response.statusCode).toBe(500)
    Object.assign(served.state, { db })
    // 'url' had already been inserted for real; its absence here is the rollback.
    expect(db.select().from(pluginSetting).all()).toEqual([])
  })

  it('accepts settings by the plural case: both declared keys land in one write', async () => {
    booted = await bootAndLogin({ spores: configurableTwoFields })
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'PUT', url: '/api/plugins/needs-config/settings', headers: { cookie },
      payload: { url: 'http://example', token: 'abc' },
    })
    expect(response.statusCode).toBe(200)
    const body = (await app.inject({
      method: 'GET', url: '/api/plugins/needs-config/settings', headers: { cookie },
    })).json<Record<string, string>>()
    expect(body).toEqual({ url: 'http://example', token: 'abc' })
  })
})
