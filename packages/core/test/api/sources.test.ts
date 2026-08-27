import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import type { SporangiumSource } from '@mycelo/septum'
import type { DriverFactory, SporeOffer } from '../../src/sporangium/driver.js'
import { recordInstall } from '../../src/config/store.js'
import type { PluginGroups } from '../../src/api/routes/plugins.js'
import { sourceLocation, sourceToken, TOKEN_MASK } from '../../src/sporangium/sources.js'
import { bundleOf } from '../support/bundle.js'
import { bootAndLogin, closeBooted, twoPluginsTwoCommands } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

interface ErrorBody { error: { code: string, message: string, detail?: unknown } }

async function sources(b: LoggedIn): Promise<readonly SporangiumSource[]> {
  return (await b.app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: b.cookie } }))
    .json<readonly SporangiumSource[]>()
}

/** Throws rather than answering undefined: every test here needs the seeded row to exist. */
async function official(b: LoggedIn): Promise<SporangiumSource> {
  const found = (await sources(b)).find((s) => s.official)
  if (found === undefined) throw new Error('the official sporangium was not seeded')
  return found
}

async function localRoot(b: LoggedIn): Promise<SporangiumSource> {
  const found = (await sources(b)).find((s) => s.driver === 'local')
  if (found === undefined) throw new Error('no local root was mirrored')
  return found
}

async function addThirdParty(b: LoggedIn, label: string): Promise<SporangiumSource> {
  return (await b.app.inject({
    method: 'POST', url: '/api/sources', headers: { cookie: b.cookie },
    payload: { label, driver: 'github', location: `https://github.com/o/${label}` },
  })).json<SporangiumSource>()
}

const MANIFEST = (name: string): string =>
  `kind: enzyme\nname: ${name}\nseptum: "^0.10"\n`
  + `commands:\n  - name: ${name}\n    description: x\n    respond: ${name}.reply\n`
  // `needy` is the two-warning case: third-party *and* an unsatisfied mandatory requirement.
  + (name === 'needy' ? 'requires:\n  - rhiza: absent-connector\n' : '')

const MODULE = 'export default { create: () => ({ handlers: {} }) }'

/**
 * A sporangium of `<name>@<strain>` bundles built in memory. Every route that reaches a
 * driver goes through it, so no test in this file opens a socket.
 */
async function fakeSporangium(offers: Record<string, readonly string[]>): Promise<DriverFactory> {
  const tarballs = new Map<string, Uint8Array>()
  for (const [name, strains] of Object.entries(offers)) {
    for (const strain of strains) {
      tarballs.set(`${name}@${strain}`, await bundleOf(name, {
        'spore.yaml': MANIFEST(name), 'index.js': MODULE,
      }))
    }
  }
  const strainsOf = (name: string): readonly string[] => offers[name] ?? []
  return () => ({
    list: () => Promise.resolve(Object.entries(offers)
      .map(([name, strains]): SporeOffer => ({ name, strain: strains[0] ?? '0.0.0' }))),
    strains: (name) => Promise.resolve(strainsOf(name)),
    detail: (name, strain) => Promise.resolve({
      name, kind: 'enzyme' as const, description: `${name} at ${strain}`, septum: '^0.10',
    }),
    fetch: (name, strain) => {
      const tarball = tarballs.get(`${name}@${strain}`)
      if (tarball === undefined) throw new Error(`no bundle for ${name}@${strain}`)
      return Promise.resolve({ tarball, strain })
    },
  })
}

describe('/api/sources', () => {
  it('lists the seeded official sporangium beside a row for the configured local root', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const listed = await sources(booted)
    // design §7 writes a row per configured local root, so this is never a one-row list —
    // §14.2 step 2's "exactly one source" is unreachable and the plan's defects table says so.
    expect(listed.filter((s) => s.official)).toHaveLength(1)
    expect(listed.find((s) => s.official)?.location).toContain('mycelo-spores')
    expect(listed.filter((s) => s.driver === 'local')).toHaveLength(1)
  })

  it('masks a token on read and never returns the stored value', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const created = (await app.inject({
      method: 'POST', url: '/api/sources', headers: { cookie },
      payload: { label: 'private', driver: 'github', location: 'https://github.com/x/y', token: 'ghp_secret' },
    })).json<SporangiumSource>()
    expect(created.token).toBe(TOKEN_MASK)
    // The positive beside the negative: masked on the wire, intact in the database.
    expect(JSON.stringify(await sources(booted))).not.toContain('ghp_secret')
    expect(sourceToken(booted.served.state.db, created.id)).toBe('ghp_secret')
  })

  it('ignores an official flag in the body', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const created = (await booted.app.inject({
      method: 'POST', url: '/api/sources', headers: { cookie: booted.cookie },
      payload: { label: 'Official', driver: 'github', location: 'https://github.com/x/y', official: true },
    })).json<SporangiumSource>()
    expect(created.official).toBe(false)
    // The control: the seeded row proves official: true is reachable at all.
    expect((await sources(booted)).filter((s) => s.official)).toHaveLength(1)
  })

  it('patches a label and keeps the stored token when the mask is sent back', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const created = (await app.inject({
      method: 'POST', url: '/api/sources', headers: { cookie },
      payload: { label: 'private', driver: 'github', location: 'https://github.com/x/y', token: 'ghp_secret' },
    })).json<SporangiumSource>()
    const patched = (await app.inject({
      method: 'PATCH', url: `/api/sources/${String(created.id)}`, headers: { cookie },
      payload: { label: 'Renamed', enabled: false, token: TOKEN_MASK },
    })).json<SporangiumSource>()
    expect(patched).toMatchObject({ label: 'Renamed', enabled: false, token: TOKEN_MASK })
    expect(sourceToken(booted.served.state.db, created.id)).toBe('ghp_secret')
    // An explicit empty string is the only way to clear it, and it does.
    await app.inject({
      method: 'PATCH', url: `/api/sources/${String(created.id)}`, headers: { cookie }, payload: { token: '' },
    })
    expect(sourceToken(booted.served.state.db, created.id)).toBeNull()
  })

  it('answers 404 for an unknown source id and for a non-numeric one', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    expect((await app.inject({ method: 'GET', url: '/api/sources/9999', headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/sources/abc', headers: { cookie } })).statusCode).toBe(404)
    // The control: a real id answers.
    const seeded = await official(booted)
    expect((await app.inject({
      method: 'GET', url: `/api/sources/${String(seeded.id)}`, headers: { cookie },
    })).statusCode).toBe(200)
  })

  it('refuses to delete the official source and deletes a third-party one, leaving the others', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const seeded = await official(booted)
    const refused = await app.inject({
      method: 'DELETE', url: `/api/sources/${String(seeded.id)}`, headers: { cookie },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json<ErrorBody>().error.message).toContain('official')

    // Two third-party rows, so a delete that emptied the table would still pass below.
    const first = await addThirdParty(booted, 'first')
    const second = await addThirdParty(booted, 'second')
    const allowed = await app.inject({
      method: 'DELETE', url: `/api/sources/${String(first.id)}`, headers: { cookie },
    })
    expect(allowed.statusCode).toBe(204)
    const remaining = (await sources(booted)).map((s) => s.id)
    expect(remaining).toContain(second.id)
    expect(remaining).not.toContain(first.id)
    // Present and undeletable: §14.2 step 2 read through design §11.
    expect(remaining).toContain(seeded.id)
  })

  it('refuses to delete a source that still provides installed spores, naming every one', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const source = await addThirdParty(booted, 'inuse')
    for (const name of ['alpha', 'beta']) {
      recordInstall(booted.served.state.db, name, 'enzyme', false, { sourceId: source.id, strain: '0.2.0' })
    }
    const refused = await app.inject({
      method: 'DELETE', url: `/api/sources/${String(source.id)}`, headers: { cookie },
    })
    expect(refused.statusCode).toBe(409)
    // Both, not the first: a message built from installed[0] would name one of the two.
    expect(refused.json<ErrorBody>().error.message).toContain('alpha, beta')
    expect((await sources(booted)).map((s) => s.id)).toContain(source.id)
  })

  it('refuses to delete a source that provides exactly one installed spore', async () => {
    // The singular beside the plural: a `length > 1` gate blocks two and lets one through,
    // and one is the ordinary case.
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const source = await addThirdParty(booted, 'single')
    recordInstall(booted.served.state.db, 'lonely', 'enzyme', false, { sourceId: source.id, strain: '0.2.0' })
    const refused = await app.inject({
      method: 'DELETE', url: `/api/sources/${String(source.id)}`, headers: { cookie },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json<ErrorBody>().error.message).toContain('lonely')
  })

  it('never repoints the official sporangium, while a third-party one is repointed freely', async () => {
    // Repointing the official row relabels an unreviewed sporangium as reviewed, and
    // inoculate keys its trust warning off `official` — worse than the deletion design §11
    // already forbids.
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const seeded = await official(booted)
    const evil = 'https://github.com/attacker/evil-spores'
    const patched = (await app.inject({
      method: 'PATCH', url: `/api/sources/${String(seeded.id)}`, headers: { cookie },
      payload: { location: evil, label: 'Relabelled', enabled: false, token: 'ghp_x' },
    })).json<SporangiumSource>()
    expect(patched.location).toBe(seeded.location)
    // §11 keeps it disable-able and re-tokenable: only the location is frozen.
    expect(patched).toMatchObject({ label: 'Relabelled', enabled: false, token: TOKEN_MASK })

    // The control: the same field, on a third-party row, is written.
    const third = await addThirdParty(booted, 'movable')
    const moved = (await app.inject({
      method: 'PATCH', url: `/api/sources/${String(third.id)}`, headers: { cookie }, payload: { location: evil },
    })).json<SporangiumSource>()
    expect(moved.location).toBe(evil)
  })

  it('refuses to add a local source, so no phantom row exists beside the mirrored ones', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const refused = await booted.app.inject({
      method: 'POST', url: '/api/sources', headers: { cookie: booted.cookie },
      payload: { label: 'hand-made', driver: 'local', location: '/srv/spores' },
    })
    expect(refused.statusCode).toBe(400)
    // The control: the boot-time mirror's own local row is still there and still listed.
    expect((await sources(booted)).filter((s) => s.driver === 'local')).toHaveLength(1)
  })

  it('masks a credential carried in a location userinfo, as it masks the token beside it', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const created = (await app.inject({
      method: 'POST', url: '/api/sources', headers: { cookie },
      payload: {
        label: 'private', driver: 'github',
        location: 'https://user:ghp_INURL@github.com/o/r', token: 'ghp_INHEADER',
      },
    })).json<SporangiumSource>()
    expect(created.location).toBe('https://github.com/o/r')
    expect(JSON.stringify(await sources(booted))).not.toContain('ghp_INURL')
    // The positive beside the negative: the driver still gets the credential it has to send.
    expect(sourceLocation(booted.served.state.db, created.id)).toBe('https://user:ghp_INURL@github.com/o/r')
  })

  it('never puts a local root\'s absolute path in a client-visible message', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const local = await localRoot(booted)
    // The label of a local row IS its absolute path, so each of these three would carry it.
    recordInstall(booted.served.state.db, 'zz-installed', 'enzyme', false, { sourceId: local.id, strain: '0.2.0' })
    const bodies = await Promise.all([
      app.inject({ method: 'GET', url: `/api/sources/${String(local.id)}/spores`, headers: { cookie } }),
      app.inject({ method: 'DELETE', url: `/api/sources/${String(local.id)}`, headers: { cookie } }),
      app.inject({
        method: 'POST', url: `/api/sources/${String(local.id)}/inoculate`,
        headers: { cookie }, payload: { name: 'greeter' },
      }),
    ])
    expect(bodies.map((r) => r.statusCode)).toEqual([404, 409, 400])
    for (const response of bodies) expect(response.body).not.toContain(local.location)
    // The positive beside it: each still says enough to act on, and the DTO still carries
    // the path where design §12 puts it.
    expect(bodies[0]?.json<ErrorBody>().error.message).toContain('local')
    expect(bodies[1]?.json<ErrorBody>().error.message).toContain('zz-installed')
    expect(local.location).toContain(booted.dir)
  })

  it('answers 401 without the session cookie, on a route that exists', async () => {
    // Fastify's onRequest runs before routing, so a 401 asserted on a URL that does not
    // exist passes whether the hook works or not.
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const seeded = await official(booted)
    const url = `/api/sources/${String(seeded.id)}/inoculate`
    expect((await booted.app.inject({ method: 'POST', url, payload: { name: 'radarr' } })).statusCode).toBe(401)
    // The control: the same URL answers something other than 401 with the cookie.
    const authenticated = await booted.app.inject({
      method: 'POST', url, headers: { cookie: booted.cookie }, payload: { name: 'radarr' },
    })
    expect(authenticated.statusCode).not.toBe(401)
  })
})

describe('browsing a sporangium', () => {
  it('lists what the driver offers, and 404s a local root with a sentence rather than an empty list', async () => {
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: await fakeSporangium({ radarr: ['0.2.0', '0.1.0'], help: ['0.2.0'] }),
    })
    const { app, cookie } = booted
    const seeded = await official(booted)
    const listed = await app.inject({
      method: 'GET', url: `/api/sources/${String(seeded.id)}/spores`, headers: { cookie },
    })
    expect(listed.statusCode).toBe(200)
    // Both offers, each with its newest strain: a list collapsed to one element still reads
    // as a working browse screen.
    expect(listed.json<readonly SporeOffer[]>()).toEqual([
      { name: 'radarr', strain: '0.2.0' }, { name: 'help', strain: '0.2.0' },
    ])

    const local = await localRoot(booted)
    const refused = await app.inject({
      method: 'GET', url: `/api/sources/${String(local.id)}/spores`, headers: { cookie },
    })
    // An empty list would read as "this source offers nothing"; design §7 says the contents
    // are the installed list.
    expect(refused.statusCode).toBe(404)
    expect(refused.json<ErrorBody>().error.message).toContain('local')
  })

  it('refuses a traversal-shaped spore name before the driver is reached', async () => {
    let reached = 0
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: () => ({
        list: () => Promise.resolve([]),
        strains: (name) => { reached += 1; return Promise.resolve(name === 'radarr' ? ['0.2.0'] : []) },
        detail: (name, strain) => Promise.resolve({ name, kind: 'enzyme' as const, description: '', septum: '^0.10' + strain.slice(0, 0) }),
        fetch: () => Promise.reject(new Error('unused')),
      }),
    })
    const seeded = await official(booted)
    const url = (name: string): string => `/api/sources/${String(seeded.id)}/spores/${name}`
    const refused = await booted.app.inject({
      method: 'GET', url: url('..%2F..%2Fetc'), headers: { cookie: booted.cookie },
    })
    expect(refused.statusCode).toBe(404)
    expect(reached).toBe(0)
    // The positive beside it: a well-formed name does reach the driver.
    expect((await booted.app.inject({ method: 'GET', url: url('radarr'), headers: { cookie: booted.cookie } })).statusCode).toBe(200)
    expect(reached).toBe(1)
  })

  it('answers the strains and the newest strain detail for one spore, and 404s an unoffered one', async () => {
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: await fakeSporangium({ radarr: ['0.2.0', '0.1.0'] }),
    })
    const { app, cookie } = booted
    const seeded = await official(booted)
    const body = (await app.inject({
      method: 'GET', url: `/api/sources/${String(seeded.id)}/spores/radarr`, headers: { cookie },
    })).json<{ strains: string[], detail: { description: string } }>()
    expect(body.strains).toEqual(['0.2.0', '0.1.0'])
    // Read at the newest strain, not the oldest: the description carries which one.
    expect(body.detail.description).toBe('radarr at 0.2.0')

    const missing = await app.inject({
      method: 'GET', url: `/api/sources/${String(seeded.id)}/spores/nosuchspore`, headers: { cookie },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('classifies a driver failure as a refusal naming the source, never an unclassified 500', async () => {
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: () => ({
        list: () => Promise.reject(new Error('GitHub answered 403 for /tags')),
        strains: () => Promise.resolve([]),
        detail: () => Promise.reject(new Error('unused')),
        fetch: () => Promise.reject(new Error('unused')),
      }),
    })
    const seeded = await official(booted)
    const response = await booted.app.inject({
      method: 'GET', url: `/api/sources/${String(seeded.id)}/spores`, headers: { cookie: booted.cookie },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<ErrorBody>().error.code).toBe('validation')
    expect(response.json<ErrorBody>().error.detail).toBe('GitHub answered 403 for /tags')
  })
})

describe('POST /api/sources/:id/inoculate', () => {
  async function bootWithSporangium(): Promise<LoggedIn> {
    return await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: await fakeSporangium({ radarr: ['0.2.0', '0.1.0'], help: ['0.2.0'] }),
    })
  }

  it('returns the third-party warning, where an install from the official sporangium returns none', async () => {
    booted = await bootWithSporangium()
    const { app, cookie } = booted
    const seeded = await official(booted)
    const third = await addThirdParty(booted, 'elsewhere')

    const reviewed = await app.inject({
      method: 'POST', url: `/api/sources/${String(seeded.id)}/inoculate`,
      headers: { cookie }, payload: { name: 'radarr' },
    })
    expect(reviewed.statusCode).toBe(200)
    expect(reviewed.json<{ name: string, strain: string, warnings: string[], restartRequired: boolean }>())
      .toEqual({ name: 'radarr', strain: '0.2.0', warnings: [], restartRequired: true })

    const unreviewed = await app.inject({
      method: 'POST', url: `/api/sources/${String(third.id)}/inoculate`,
      headers: { cookie }, payload: { name: 'help', strain: '0.2.0' },
    })
    expect(unreviewed.statusCode).toBe(200)
    const body = unreviewed.json<{ warnings: string[] }>()
    // The two halves are each other's control: a route that always attached the warning, or
    // never did, would pass either assertion alone (design §11).
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toContain('not code-reviewed')
  })

  it('unpacks into the managed root, where /api/plugins then reports its sporangium and strain', async () => {
    booted = await bootWithSporangium()
    const { app, cookie } = booted
    const seeded = await official(booted)
    await app.inject({
      method: 'POST', url: `/api/sources/${String(seeded.id)}/inoculate`,
      headers: { cookie }, payload: { name: 'radarr', strain: '0.1.0' },
    })
    // The managed root, not a configured one: an install landing in `spores:` would still
    // answer 200 and still germinate, and nothing about the response would say so.
    expect(readdirSync(join(booted.dir, 'spores', 'radarr')).sort()).toEqual(['index.js', 'spore.yaml'])
    const groups = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    expect(groups.enzyme.find((p) => p.name === 'radarr'))
      .toMatchObject({ source: 'Mycelo spores', strain: '0.1.0', enabled: false })
    // The control: a spore from a local root reports neither (design §7.4).
    expect(groups.enzyme.find((p) => p.name === 'greeter')).not.toHaveProperty('strain')

    expect((await app.inject({
      method: 'POST', url: '/api/plugins/radarr/enable', headers: { cookie },
    })).statusCode).toBe(200)
    const after = (await app.inject({ method: 'GET', url: '/api/plugins', headers: { cookie } })).json<PluginGroups>()
    // Enabled but not yet germinated, so listPlugins omits it — the limitation phase 5
    // recorded. What must never happen is a spore sitting on disk reported as absent from it.
    expect(after.enzyme.filter((p) => p.name === 'radarr' && p.reason !== undefined)).toEqual([])
  })

  it('carries every warning inoculate produced, not the first of them', async () => {
    // Two at once, in inoculate's own order: the trust sentence then the dormancy one. A
    // response keeping either end alone reads as a complete answer (design §11).
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: await fakeSporangium({ needy: ['0.2.0'] }),
    })
    const third = await addThirdParty(booted, 'elsewhere')
    const body = (await booted.app.inject({
      method: 'POST', url: `/api/sources/${String(third.id)}/inoculate`,
      headers: { cookie: booted.cookie }, payload: { name: 'needy' },
    })).json<{ warnings: string[] }>()
    expect(body.warnings).toHaveLength(2)
    expect(body.warnings[0]).toContain('not code-reviewed')
    expect(body.warnings[1]).toContain("'absent-connector'")
    expect(body.warnings[1]).toContain('dormant')
  })

  it('answers 400 naming the strains that exist', async () => {
    booted = await bootWithSporangium()
    const seeded = await official(booted)
    const response = await booted.app.inject({
      method: 'POST', url: `/api/sources/${String(seeded.id)}/inoculate`,
      headers: { cookie: booted.cookie }, payload: { name: 'radarr', strain: '99.0.0' },
    })
    expect(response.statusCode).toBe(400)
    const { error } = response.json<ErrorBody>()
    expect(error.message).toContain('radarr')
    // Both published strains, so the operator can pick one without a second request.
    expect(String(error.detail)).toContain('0.2.0, 0.1.0')
  })

  it('refuses a local source and a spore the sporangium does not offer', async () => {
    booted = await bootWithSporangium()
    const { app, cookie } = booted
    const local = await localRoot(booted)
    const localRefusal = await app.inject({
      method: 'POST', url: `/api/sources/${String(local.id)}/inoculate`,
      headers: { cookie }, payload: { name: 'radarr' },
    })
    expect(localRefusal.statusCode).toBe(400)
    expect(String(localRefusal.json<ErrorBody>().error.detail)).toContain('already installed')

    const seeded = await official(booted)
    const unknown = await app.inject({
      method: 'POST', url: `/api/sources/${String(seeded.id)}/inoculate`,
      headers: { cookie }, payload: { name: 'nosuchspore' },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it('classifies a throw out of inoculate as an internal fault, and keeps it out of the body', async () => {
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      driverFor: () => { throw new Error(`ENOENT: no such file, scandir '/tmp/secret-path/spores'`) },
    })
    const seeded = await official(booted)
    const response = await booted.app.inject({
      method: 'POST', url: `/api/sources/${String(seeded.id)}/inoculate`,
      headers: { cookie: booted.cookie }, payload: { name: 'radarr' },
    })
    // Spec §10: classified, and the absolute path stays in the operator's log. 500, not 400:
    // the fault is on the server's own managed root, so re-prompting the operator is a lie.
    expect(response.statusCode).toBe(500)
    expect(response.json<ErrorBody>().error.code).toBe('internal')
    expect(response.body).not.toContain('/tmp/secret-path')
    expect(response.json<ErrorBody>().error.message).toContain('radarr')
  })
})
