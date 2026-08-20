import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { writeSetting } from '../../src/config/store.js'
import { pluginSetting } from '../../src/persistence/schema.js'
import type { PluginGroups } from '../../src/api/routes/plugins.js'
import {
  bootAndLogin, brokenManifest, closeBooted, closedJsonSchema, configurable, configurableTwoFields,
  cyclingPair, definedSchema, eitherOrSchema, mixedFieldSchema, noJsonSchema,
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
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    // fixtures/ping declares kind: enzyme.
    const ping = body.enzyme.find((p) => p.name === 'ping')
    // septum's own doc comment: disable() is reflected only by the next germination, so
    // the two disagree here on purpose. Phase 5's blocker was reporting only one of them.
    expect(ping).toMatchObject({ state: 'germinated', enabled: false })
  })

  it('reports unknown, never dormant, for every plugin while degraded', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    expect(booted.served.state.germination.status).toBe('degraded')
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    // cyclingPair's alpha and beta both declare kind: rhiza.
    // Reporting them dormant would send the operator hunting two faults when there is one.
    expect(body.rhiza.map((p) => p.state)).toEqual(['unknown', 'unknown'])
    expect(body.hypha).toEqual([])
    expect(body.enzyme).toEqual([])
    expect(body.inhibitor).toEqual([])
    expect(body.unknown).toEqual([])
  })

  it('groups every kind, with an always-present unknown bucket, and never drops a plugin whose manifest never parsed', async () => {
    booted = await bootAndLogin({ spores: brokenManifest })
    const { app, cookie } = booted
    // germination itself still succeeds: one spore is dormant, the run is not degraded.
    expect(booted.served.state.germination.status).toBe('germinated')
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    // All five keys present even though only one is non-empty (spec §8).
    expect(Object.keys(body).sort()).toEqual(['enzyme', 'hypha', 'inhibitor', 'rhiza', 'unknown'])
    expect(body.hypha).toEqual([])
    expect(body.enzyme).toEqual([])
    expect(body.rhiza).toEqual([])
    expect(body.inhibitor).toEqual([])
    const broken = body.unknown.find((p) => p.name === 'brokenyaml')
    // Not vanished, and not miscategorised into a kind it never validated as.
    expect(broken).toMatchObject({ state: 'dormant' })
    expect(broken?.kind).toBeUndefined()
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
    const body = response.json<{ error: { message: string, detail: string } }>()
    // Rendered text: the message itself, not only detail, must be the real sentence.
    expect(body.error.message).toBe("plugin 'needs-config' could not be enabled")
    // The plural case: an error built from issues[0] would pass a one-field fixture.
    expect(body.error.detail).toContain('url')
    expect(body.error.detail).toContain('token')
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
    const response = await app.inject({ method: 'GET', url: '/api/plugins/ghost', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    // Rendered text, not just the status: the translator falls back to the raw key on a
    // typo or a missing catalogue entry, which a status-only assertion cannot catch.
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("no plugin named 'ghost' is installed")
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
    const body = response.json<{ error: { message: string, detail: string[] } }>()
    // detail is structured (§9): a form highlighting fields must not have to parse a
    // localized sentence back apart to find them.
    expect(body.error.detail).toEqual(['bogus', 'alsoBogus'])
    // The message still names them too, in order — this is what item 2's rendered-text
    // rule pins for this key.
    expect(body.error.message).toBe("plugin 'needs-config' declares no setting named: bogus, alsoBogus")
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

  // Every other settings test uses a fixture that publishes a schema, so `undeclaredKeys`
  // could refuse *every* key on the unguarded path with the whole suite green (campaign
  // M50) — shutting the operator out of the one surface `jsonschema.ts:17` tells them to use.
  it('writes a setting for a plugin that publishes no JSON Schema, which is the unguarded case by design', async () => {
    booted = await bootAndLogin({ spores: noJsonSchema })
    const { app, cookie } = booted
    const schema = (await app.inject({
      method: 'GET', url: '/api/plugins/freeform/schema', headers: { cookie },
    })).json<{ available: boolean }>()
    expect(schema.available).toBe(false)
    const response = await app.inject({
      method: 'PUT', url: '/api/plugins/freeform/settings', headers: { cookie },
      payload: { anything: 'goes', andAnother: 2 },
    })
    expect(response.statusCode).toBe(200)
    expect((await app.inject({
      method: 'GET', url: '/api/plugins/freeform/settings', headers: { cookie },
    })).json<Record<string, unknown>>()).toEqual({ anything: 'goes', andAnother: 2 })
  })

  // The only fixture emitting `additionalProperties` at all: without it both halves of
  // `open`'s `&&` answer the same everywhere, so dropping the `!== false` half survived
  // (campaign M51) and a strictObject plugin would silently accept a typo'd key.
  it('refuses an undeclared key against a closed schema, which is not the same as an absent additionalProperties', async () => {
    booted = await bootAndLogin({ spores: closedJsonSchema })
    const { app, cookie } = booted
    const refused = await app.inject({
      method: 'PUT', url: '/api/plugins/strict/settings', headers: { cookie },
      payload: { nope: 1 },
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.json<{ error: { message: string, detail: string[] } }>().error).toMatchObject({
      code: 'validation',
      message: "plugin 'strict' declares no setting named: nope",
      detail: ['nope'],
    })
    // Not simply refusing everything: the declared key still writes.
    expect((await app.inject({
      method: 'PUT', url: '/api/plugins/strict/settings', headers: { cookie },
      payload: { token: 'abc' },
    })).statusCode).toBe(200)
  })
})

// Spec §8 says "validated against the plugin's schema" and the route validated key *names*
// only, so `{ port: 'not-a-number' }` was written with 200 and the operator learned about it
// at the next boot, from a plugin gone dormant (review, Important 3).
describe('PUT /api/plugins/:name/settings validates the values', () => {
  it('refuses a value through the whole-object schema even though the plugin also exposes a permissive shape, and writes nothing', async () => {
    booted = await bootAndLogin({ spores: mixedFieldSchema })
    const { app, cookie } = booted
    const refused = await app.inject({
      method: 'PUT', url: '/api/plugins/mixed/settings', headers: { cookie },
      payload: { port: 'not-a-number', label: 'fine' },
    })
    expect(refused.statusCode).toBe(400)
    const error = refused.json<{ error: { code: string, message: string, detail: unknown } }>().error
    expect(error.code).toBe('validation')
    expect(error.message).toBe("plugin 'mixed' rejected the value given for: port")
    // §9: detail carries the plugin's own issues, so a form can highlight the field.
    expect(error.detail).toEqual([{ key: 'port', issues: [{ path: ['port'], message: 'expected a number' }] }])
    // All-or-nothing: the sound key travelled in the same body and must not have landed.
    expect((await app.inject({
      method: 'GET', url: '/api/plugins/mixed/settings', headers: { cookie },
    })).json<Record<string, unknown>>()).toEqual({})
  })

  it('accepts the same keys once every value parses', async () => {
    booted = await bootAndLogin({ spores: mixedFieldSchema })
    const { app, cookie } = booted
    expect((await app.inject({
      method: 'PUT', url: '/api/plugins/mixed/settings', headers: { cookie },
      payload: { port: 8080, label: 'fine' },
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'GET', url: '/api/plugins/mixed/settings', headers: { cookie },
    })).json<Record<string, unknown>>()).toEqual({ port: 8080, label: 'fine' })
  })

  // `defineConfig` publishes safeParse alone, so a shape-only fix would be inert for every
  // plugin written the documented way: this fixture has no shape at all.
  it('refuses a bad value through the whole-object schema a defineConfig plugin publishes', async () => {
    booted = await bootAndLogin({ spores: definedSchema })
    const { app, cookie } = booted
    const refused = await app.inject({
      method: 'PUT', url: '/api/plugins/defined/settings', headers: { cookie },
      payload: { port: 'not-a-number' },
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.json<{ error: { message: string } }>().error.message)
      .toBe("plugin 'defined' rejected the value given for: port")
  })

  // septum documents `path: []` as a whole-object refusal and the kit certifies one, so the
  // per-key filter answered [] and this PUT was written with 200 (review, Important 1).
  it('refuses a whole-object rejection and highlights every key it was given', async () => {
    booted = await bootAndLogin({ spores: eitherOrSchema })
    const { app, cookie } = booted
    const refused = await app.inject({
      method: 'PUT', url: '/api/plugins/eitheror/settings', headers: { cookie },
      payload: { socket: '/tmp/s', tcp: 'host:1' },
    })
    expect(refused.statusCode).toBe(400)
    const error = refused.json<{ error: { message: string, detail: unknown } }>().error
    expect(error.message).toBe("plugin 'eitheror' rejected the value given for: socket, tcp")
    expect(error.detail).toEqual([
      { key: 'socket', issues: [{ path: [], message: 'socket or tcp, not both' }] },
      { key: 'tcp', issues: [{ path: [], message: 'socket or tcp, not both' }] },
    ])
    expect((await app.inject({
      method: 'GET', url: '/api/plugins/eitheror/settings', headers: { cookie },
    })).json<Record<string, unknown>>()).toEqual({})
  })

  // The property that rules out validating the merged object, which is §8's literal reading:
  // a required field the operator has not filled in yet is enablePlugin's business, not this
  // route's, or a two-field form could never be filled one field at a time.
  it('accepts a partial write although a required key is still missing', async () => {
    booted = await bootAndLogin({ spores: definedSchema })
    const { app, cookie } = booted
    expect((await app.inject({
      method: 'PUT', url: '/api/plugins/defined/settings', headers: { cookie },
      payload: { label: 'later' },
    })).statusCode).toBe(200)
    // And the refusal that proves the acceptance above is not blanket tolerance.
    expect((await app.inject({
      method: 'PUT', url: '/api/plugins/defined/settings', headers: { cookie },
      payload: { label: 7 },
    })).statusCode).toBe(400)
  })
})
