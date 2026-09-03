import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { assignRole, createRole } from '../../src/authorization/roles.js'
import { markReviewed } from '../../src/identity/people.js'
import { channelIdentity, principal } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'
import type { PeoplePage } from '../../src/identity/people.js'
import { bootAndLogin, closeBooted } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

/** createdAt derived from the id's digits, so orderBy is deterministic across fixtures. */
function person(db: Db, id: string, displayName: string): void {
  const rank = Number(id.replace(/\D/g, '') || '0')
  db.insert(principal)
    .values({ id, displayName, createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + rank) })
    .run()
}

function identity(db: Db, principalId: string, channel: string, externalId: string): void {
  db.insert(channelIdentity)
    .values({ channel, externalId, principalId, firstSeenAt: new Date() })
    .run()
}

describe('GET /api/people', () => {
  it('paginates, reports the true total, and does not repeat the first page on the second', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    // bootAndLogin's setup wizard already created the owner principal; scope every
    // assertion below to the fixture rows through `q=`, rather than assuming a bare count.
    for (let i = 0; i < 5; i++) person(served.state.db, `search-${String(i)}`, `Search ${String(i)}`)
    const first = (await app.inject({
      method: 'GET', url: '/api/people?q=Search&page=1&perPage=2', headers: { cookie },
    })).json<PeoplePage>()
    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.page).toBe(1)
    expect(first.perPage).toBe(2)

    const second = (await app.inject({
      method: 'GET', url: '/api/people?q=Search&page=2&perPage=2', headers: { cookie },
    })).json<PeoplePage>()
    // An OFFSET computed as `page * perPage` instead of `(page - 1) * perPage` skips a
    // whole page and would still pass a single-page fixture.
    const firstIds = first.items.map((p) => p.id)
    const secondIds = second.items.map((p) => p.id)
    expect(secondIds).toHaveLength(2)
    expect(secondIds).not.toEqual(firstIds)
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4)
  })

  it('defaults to page 1 and perPage 50 with no query string', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/people', headers: { cookie } })).json<PeoplePage>()
    expect(body.page).toBe(1)
    expect(body.perPage).toBe(50)
  })

  it('clamps perPage to 200 and reports the applied value, not the requested one', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({
      method: 'GET', url: '/api/people?perPage=500', headers: { cookie },
    })).json<PeoplePage>()
    // A clamp that serves 200 while still reporting 500 is exactly the defect spec §8 forbids.
    expect(body.perPage).toBe(200)
  })

  it('matches on a display name and on a channel external id, one person for both', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'match-alice', 'Zelda Matcher')
    identity(served.state.db, 'match-alice', 'console', 'zelda-99')
    person(served.state.db, 'match-bob', 'Bob Other')
    const byName = (await app.inject({
      method: 'GET', url: '/api/people?q=Zelda', headers: { cookie },
    })).json<PeoplePage>()
    expect(byName.items.map((p) => p.id)).toEqual(['match-alice'])
    const byIdentity = (await app.inject({
      method: 'GET', url: '/api/people?q=99', headers: { cookie },
    })).json<PeoplePage>()
    expect(byIdentity.items.map((p) => p.id)).toEqual(['match-alice'])
  })

  it('filters the never-reviewed, and returns the others when asked, both directions', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'rev-yes', 'Reviewed Yes')
    person(served.state.db, 'rev-no', 'Reviewed No')
    markReviewed(served.state.db, 'rev-yes')
    const unreviewed = (await app.inject({
      method: 'GET', url: '/api/people?q=Reviewed&reviewed=false', headers: { cookie },
    })).json<PeoplePage>()
    expect(unreviewed.items.map((p) => p.id)).toEqual(['rev-no'])
    // Both directions: a predicate that ignored the flag would pass the first assertion
    // alone whenever the fixture happened to have one of each.
    const reviewed = (await app.inject({
      method: 'GET', url: '/api/people?q=Reviewed&reviewed=true', headers: { cookie },
    })).json<PeoplePage>()
    expect(reviewed.items.map((p) => p.id)).toEqual(['rev-yes'])
  })

  it('a malformed query string is a 400 with the query-invalid message, over real HTTP', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'GET', url: '/api/people?page=not-a-number', headers: { cookie },
    })
    expect(response.statusCode).toBe(400)
    const body = response.json<{ error: { code: string, message: string } }>()
    expect(body.error.code).toBe('validation')
    expect(body.error.message).toBe('the query string is invalid')
  })
})

describe('GET /api/people/:id', () => {
  it('404s on an unknown id with the rendered message', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({ method: 'GET', url: '/api/people/ghost', headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no person with id 'ghost'")
  })
})

describe('PATCH /api/people/:id', () => {
  it('updates displayName and reviewed together', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'patch-me', 'Old Name')
    const response = await app.inject({
      method: 'PATCH', url: '/api/people/patch-me', headers: { cookie },
      payload: { displayName: 'New Name', reviewed: true },
    })
    expect(response.statusCode).toBe(200)
    const after = (await app.inject({
      method: 'GET', url: '/api/people/patch-me', headers: { cookie },
    })).json<{ displayName?: string }>()
    expect(after.displayName).toBe('New Name')
  })

  it('404s on an unknown id and writes nothing', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'PATCH', url: '/api/people/ghost', headers: { cookie },
      payload: { displayName: 'Anyone' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no person with id 'ghost'")
    // No row was created as a side effect of the failed patch.
    const after = await app.inject({ method: 'GET', url: '/api/people/ghost', headers: { cookie } })
    expect(after.statusCode).toBe(404)
  })

  it('404s on an unknown id even with an empty body, rather than answering 200 with null', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'PATCH', url: '/api/people/ghost', headers: { cookie }, payload: {},
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /api/people/:id/roles and DELETE /api/people/:id/roles/:role', () => {
  it('assigns a role, is idempotent on a second identical grant, and lists it on the person', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'grant-me', 'Grant Me')
    createRole(served.state.db, 'guest', ['ping.*'])
    const first = await app.inject({
      method: 'POST', url: '/api/people/grant-me/roles', headers: { cookie }, payload: { role: 'guest' },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST', url: '/api/people/grant-me/roles', headers: { cookie }, payload: { role: 'guest' },
    })
    expect(second.statusCode).toBe(200)
    const person2 = (await app.inject({
      method: 'GET', url: '/api/people/grant-me', headers: { cookie },
    })).json<{ roles: string[] }>()
    expect(person2.roles).toEqual(['guest'])
  })

  it('404s granting an unknown role, naming the role', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'grant-target', 'Grant Target')
    const response = await app.inject({
      method: 'POST', url: '/api/people/grant-target/roles', headers: { cookie }, payload: { role: 'ghost-role' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('404s granting a real role to an unknown person, naming the person', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    createRole(booted.served.state.db, 'guest2', ['ping.*'])
    const response = await app.inject({
      method: 'POST', url: '/api/people/ghost/roles', headers: { cookie }, payload: { role: 'guest2' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no person with id 'ghost'")
  })

  it('revokes a role, is idempotent on a second identical revoke', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'revoke-me', 'Revoke Me')
    createRole(served.state.db, 'guest3', ['ping.*'])
    await app.inject({
      method: 'POST', url: '/api/people/revoke-me/roles', headers: { cookie }, payload: { role: 'guest3' },
    })
    const first = await app.inject({
      method: 'DELETE', url: '/api/people/revoke-me/roles/guest3', headers: { cookie },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'DELETE', url: '/api/people/revoke-me/roles/guest3', headers: { cookie },
    })
    expect(second.statusCode).toBe(200)
    const person2 = (await app.inject({
      method: 'GET', url: '/api/people/revoke-me', headers: { cookie },
    })).json<{ roles: string[] }>()
    expect(person2.roles).toEqual([])
  })

  it('404s revoking an unknown role, naming the role', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'revoke-target', 'Revoke Target')
    const response = await app.inject({
      method: 'DELETE', url: '/api/people/revoke-target/roles/ghost-role', headers: { cookie },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('names the role, not the person, when both are unknown at once', async () => {
    // assignRole checks the role before the principal (authorization/roles.ts); this pins
    // that order rather than the two single-refusal tests above, which never exercise it.
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const response = await app.inject({
      method: 'POST', url: '/api/people/ghost/roles', headers: { cookie }, payload: { role: 'ghost-role' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toBe("no role named 'ghost-role'")
  })

  it('does not relabel a genuine store fault as a 404', async () => {
    // The banned pattern (`throw notFound((e as Error).message)`) would turn this into a
    // 404 naming a raw driver message. A real fault must reach the generic 500 handler.
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'fault-target', 'Fault Target')
    createRole(served.state.db, 'guest4', ['ping.*'])
    const db = served.state.db
    const faultyDb = new Proxy(db, {
      get(target, prop, receiver) {
        // 'insert', not 'select': the auth hooks (readSession) only select/update, so this
        // isolates the fault to assignRole's own write rather than tripping on login.
        if (prop === 'insert') return () => { throw new Error('database is on fire') }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    Object.assign(served.state, { db: faultyDb })
    const response = await app.inject({
      method: 'POST', url: '/api/people/fault-target/roles', headers: { cookie }, payload: { role: 'guest4' },
    })
    Object.assign(served.state, { db })
    expect(response.statusCode).toBe(500)
    const body = response.json<{ error: { code: string, message: string } }>()
    expect(body.error.code).toBe('internal')
    expect(body.error.message).toBe('an internal error occurred')
  })
})

describe('GET /api/people?role=', () => {
  it('answers only the people who hold that role, and a total that counts them', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'role-anais', 'Anaïs')
    person(served.state.db, 'role-theo', 'Théo')
    person(served.state.db, 'role-guest', 'Guest Person')
    createRole(served.state.db, 'family', ['ping.*'])
    createRole(served.state.db, 'guest', ['ping.*'])
    assignRole(served.state.db, 'role-anais', 'family')
    assignRole(served.state.db, 'role-theo', 'family')
    assignRole(served.state.db, 'role-guest', 'guest')

    const body = (await app.inject({
      method: 'GET', url: '/api/people?role=family', headers: { cookie },
    })).json<{ items: { displayName?: string }[], total: number }>()

    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.map((p) => p.displayName).sort()).toEqual(['Anaïs', 'Théo'])
  })

  // The whole point of the filter is the count 2f and 2g show; a filter that degrades to
  // "everyone" for an unknown name would render 128 beside every role.
  it('answers zero for a role nobody holds, never everybody', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted

    const body = (await app.inject({
      method: 'GET', url: '/api/people?role=nobody-holds-this', headers: { cookie },
    })).json<{ items: unknown[], total: number }>()

    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  it('combines with q, rather than replacing it', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'role-anais2', 'Anaïs')
    person(served.state.db, 'role-theo2', 'Théo')
    // Matches q=Th too, but holds a different role: without this, q=Th alone already
    // narrows to the answer role= is meant to produce, and the test cannot fail.
    person(served.state.db, 'role-thomas2', 'Thomas')
    createRole(served.state.db, 'family2', ['ping.*'])
    createRole(served.state.db, 'guest2', ['ping.*'])
    assignRole(served.state.db, 'role-anais2', 'family2')
    assignRole(served.state.db, 'role-theo2', 'family2')
    assignRole(served.state.db, 'role-thomas2', 'guest2')

    const byQAlone = (await app.inject({
      method: 'GET', url: '/api/people?q=Th', headers: { cookie },
    })).json<{ total: number }>()
    expect(byQAlone.total).toBe(2)

    const body = (await app.inject({
      method: 'GET', url: '/api/people?role=family2&q=Th', headers: { cookie },
    })).json<{ total: number }>()

    expect(body.total).toBe(1)
  })

  // `?role=` is refused, not silently ignored: a caller that means "no role filter" omits
  // the parameter, and answering everybody to an empty one is the filter degrading again.
  it('refuses an empty role rather than answering everybody', async () => {
    booted = await bootAndLogin()

    const answer = await booted.app.inject({
      method: 'GET', url: '/api/people?role=', headers: { cookie: booted.cookie },
    })

    expect(answer.statusCode).toBe(400)
  })
})
