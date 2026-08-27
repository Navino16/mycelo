import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { REDACTED } from '../../src/support/redaction.js'
import { readSettings, writeSetting } from '../../src/config/store.js'
import { pluginInstall, pluginSetting } from '../../src/persistence/schema.js'
import { addSource } from '../../src/sporangium/sources.js'
import { inoculate } from '../../src/sporangium/inoculate.js'
import { managedRoot } from '../../src/sporangium/layout.js'
import { bundleOf } from '../support/bundle.js'
import { silentLogger } from '../support/logger.js'
import type { PluginGroups } from '../../src/api/routes/plugins.js'
import {
  bootAndLogin, brokenManifest, closeBooted, closedJsonSchema, configurable, configurableTwoFields,
  cyclingPair, definedSchema, eitherOrSchema, mixedFieldSchema, noJsonSchema, twoPluginsTwoCommands, vault,
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

  it('reports the sporangium label and the strain of an installed spore, and neither for a local one', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, served, cookie } = booted
    const sporangium = addSource(served.state.db, { label: 'Mycelo spores', driver: 'github', location: 'https://example/a' })
    served.state.db.update(pluginInstall).set({ sourceId: sporangium.id, strain: '0.2.0' })
      .where(eq(pluginInstall.name, 'greeter')).run()
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    expect(body.enzyme.find((p) => p.name === 'greeter'))
      .toMatchObject({ state: 'germinated', source: 'Mycelo spores', strain: '0.2.0' })
    const counter = body.enzyme.find((p) => p.name === 'counter')
    expect(counter?.state).toBe('germinated')
    expect(counter?.source).toBeUndefined()
    expect(counter?.strain).toBeUndefined()
  })

  // The `status !== 'germinated'` branch, which reads the install rows directly and so has
  // its own copy of every field a UI renders.
  it('carries provenance while degraded, where no plugin has a germination state', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, served, cookie } = booted
    expect(served.state.germination.status).toBe('degraded')
    const sporangium = addSource(served.state.db, { label: 'Someone else', driver: 'github', location: 'https://example/b' })
    served.state.db.update(pluginInstall).set({ sourceId: sporangium.id, strain: '1.2.3' })
      .where(eq(pluginInstall.name, 'alpha')).run()
    const body = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    expect(body.rhiza.find((p) => p.name === 'alpha'))
      .toMatchObject({ state: 'unknown', source: 'Someone else', strain: '1.2.3' })
    const beta = body.rhiza.find((p) => p.name === 'beta')
    expect(beta?.state).toBe('unknown')
    expect(beta?.source).toBeUndefined()
    expect(beta?.strain).toBeUndefined()
  })

  it('redacts a secret on read and keeps it secret on write', async () => {
    booted = await bootAndLogin({ spores: configurable })
    const { app, served, cookie } = booted
    // `needs-config` declares no `secrets`, so the flag can only come from the existing row:
    // the property under test is the carry-forward, seeded directly as phase 5's own
    // regression test did.
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

  // rewriteSetting has two callers; a test of writeDeclaredSetting alone proves nothing
  // about this route, which resolves secretKeysOf before its transaction, not inside it.
  it('the PUT route stores a declared secret as secret', async () => {
    booted = await bootAndLogin({ spores: vault })
    const { app, served, cookie } = booted
    const written = await app.inject({
      method: 'PUT', url: '/api/plugins/vault/settings', headers: { cookie },
      payload: { token: 's3cr3t' },
    })
    expect(written.statusCode).toBe(200)
    const read = await app.inject({ method: 'GET', url: '/api/plugins/vault/settings', headers: { cookie } })
    expect(read.json<Record<string, string>>()).toEqual({ token: REDACTED })
    expect(readSettings(served.state.db, 'vault')).toEqual({ token: 's3cr3t' })
  })

  it('a form round trip through the route keeps the credential', async () => {
    booted = await bootAndLogin({ spores: vault })
    const { app, served, cookie } = booted
    await app.inject({
      method: 'PUT', url: '/api/plugins/vault/settings', headers: { cookie },
      payload: { token: 's3cr3t' },
    })
    const shown = (await app.inject({
      method: 'GET', url: '/api/plugins/vault/settings', headers: { cookie },
    })).json<Record<string, string>>()
    // Exactly what a generated form sends back: everything it was handed, with one field edited.
    const response = await app.inject({
      method: 'PUT', url: '/api/plugins/vault/settings', headers: { cookie },
      payload: { ...shown, url: 'http://changed' },
    })
    expect(response.statusCode).toBe(200)
    expect(readSettings(served.state.db, 'vault')).toEqual({ token: 's3cr3t', url: 'http://changed' })
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

/**
 * The managed root is not a configured spores root, so every disk lookup that reads
 * `sporesDirs` alone is blind to an inoculated spore — and each of these three guards
 * fails open rather than closed when it cannot find the module (design §9, §12).
 */
describe('a spore installed into the managed root', () => {
  const MANIFEST = 'kind: enzyme\nname: keyring\nseptum: "^0.10"\n'
    + 'commands:\n  - name: keyring\n    description: Report the configured setting\n    code: handleConfigured\n'

  const MODULE = `
    export default {
      configSchema: {
        secrets: ['token'],
        safeParse: (input) => (typeof input?.token === 'string'
          ? { success: true, data: input }
          : { success: false, error: { issues: [{ path: ['token'], message: 'missing required field' }] } }),
        toJsonSchema: () => ({
          type: 'object',
          properties: { token: { type: 'string' }, url: { type: 'string' } },
          required: ['token'],
        }),
      },
      create: () => ({ handlers: { handleConfigured: async () => {} } }),
    }
  `

  async function inoculateKeyring(b: LoggedIn): Promise<void> {
    const { db, config } = b.served.state
    const source = addSource(db, {
      label: 'Someone else', driver: 'github', location: 'https://github.com/o/r',
    })
    const tarball = await bundleOf('keyring', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const driver = {
      list: () => Promise.resolve([{ name: 'keyring', strain: '0.2.0' }]),
      strains: () => Promise.resolve(['0.2.0']),
      detail: () => Promise.resolve({ name: 'keyring', kind: 'enzyme' as const, description: '', septum: '^0.10' }),
      fetch: (_name: string, strain: string) => Promise.resolve({ tarball, strain }),
    }
    const result = await inoculate({
      db,
      sporesDirs: config.sporesDirs,
      managedRoot: managedRoot(config.databaseFile),
      logger: silentLogger(),
      driverFor: () => driver,
    }, { sourceId: source.id, name: 'keyring' })
    if (!result.ok) throw new Error(`the fixture failed to install: ${result.reason}`)
  }

  it('refuses an undeclared key, refuses an invalid value and stores its credential masked', async () => {
    booted = await bootAndLogin({ spores: configurable })
    await inoculateKeyring(booted)
    const { app, cookie } = booted

    // The plural case: a route reading only issues[0] would name one of the two.
    const undeclared = await app.inject({
      method: 'PUT', url: '/api/plugins/keyring/settings', headers: { cookie },
      payload: { token: 's3cret', notADeclaredKey: 42, alsoUndeclared: 'x' },
    })
    expect(undeclared.statusCode).toBe(400)
    expect(undeclared.json<{ error: { detail: string[] } }>().error.detail.sort())
      .toEqual(['alsoUndeclared', 'notADeclaredKey'])

    const invalid = await app.inject({
      method: 'PUT', url: '/api/plugins/keyring/settings', headers: { cookie },
      payload: { token: 42 },
    })
    expect(invalid.statusCode).toBe(400)

    // The positive beside both negatives: a declared, valid write is accepted.
    const accepted = await app.inject({
      method: 'PUT', url: '/api/plugins/keyring/settings', headers: { cookie },
      payload: { token: 's3cret', url: 'https://example.test' },
    })
    expect(accepted.statusCode).toBe(200)

    // Masked on the wire, intact in the database — the flag is written, not merely honoured.
    const read = (await app.inject({
      method: 'GET', url: '/api/plugins/keyring/settings', headers: { cookie },
    })).json<Record<string, unknown>>()
    expect(read).toEqual({ token: REDACTED, url: 'https://example.test' })
    expect(readSettings(booted.served.state.db, 'keyring')).toEqual({ token: 's3cret', url: 'https://example.test' })
  })

  it('publishes its form schema and refuses to enable it until the required field is set', async () => {
    booted = await bootAndLogin({ spores: configurable })
    await inoculateKeyring(booted)
    const { app, cookie } = booted

    const refused = await app.inject({ method: 'POST', url: '/api/plugins/keyring/enable', headers: { cookie } })
    expect(refused.statusCode).toBe(400)

    const schema = (await app.inject({
      method: 'GET', url: '/api/plugins/keyring/schema', headers: { cookie },
    })).json<{ available: boolean, schema?: { required?: string[] } }>()
    expect(schema.available).toBe(true)
    expect(schema.schema?.required).toEqual(['token'])

    await app.inject({
      method: 'PUT', url: '/api/plugins/keyring/settings', headers: { cookie },
      payload: { token: 's3cret' },
    })
    // The control for the refusal above: the same route, same spore, once the field is set.
    const enabled = await app.inject({ method: 'POST', url: '/api/plugins/keyring/enable', headers: { cookie } })
    expect(enabled.statusCode).toBe(200)
  })

  // spec §5: before this, an enabled install awaiting germination was dropped from the list
  // entirely, so the screen an operator lands on after enabling did not show the plugin.
  it('reports an enabled install awaiting germination as pending, having reported it disabled', async () => {
    booted = await bootAndLogin({ spores: configurable })
    await inoculateKeyring(booted)
    const { app, cookie } = booted
    const listed = async (): Promise<{ state: string, enabled: boolean } | undefined> => {
      const groups = (await app.inject({
        method: 'GET', url: '/api/plugins', headers: { cookie },
      })).json<Record<string, { name: string, state: string, enabled: boolean }[]>>()
      return Object.values(groups).flat().find((p) => p.name === 'keyring')
    }

    expect(await listed()).toMatchObject({ state: 'disabled', enabled: false })

    await app.inject({
      method: 'PUT', url: '/api/plugins/keyring/settings', headers: { cookie },
      payload: { token: 's3cret' },
    })
    const enabled = await app.inject({ method: 'POST', url: '/api/plugins/keyring/enable', headers: { cookie } })
    expect(enabled.statusCode).toBe(200)

    expect(await listed()).toMatchObject({ state: 'pending', enabled: true })
  })
})
