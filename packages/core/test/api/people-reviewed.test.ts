import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import { principal } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'
import { bootAndLogin, closeBooted } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

function person(db: Db, id: string, displayName: string): void {
  db.insert(principal).values({ id, displayName, createdAt: new Date() }).run()
}

describe('reviewed on the person DTO', () => {
  it('a fresh principal answers reviewed: false, on both the list and the detail route', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'fresh-1', 'Fresh One')

    const detail = (await app.inject({
      method: 'GET', url: '/api/people/fresh-1', headers: { cookie },
    })).json<{ reviewed: boolean }>()
    expect(detail.reviewed).toBe(false)

    const list = (await app.inject({
      method: 'GET', url: '/api/people?q=Fresh', headers: { cookie },
    })).json<{ items: readonly { id: string, reviewed: boolean }[] }>()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.reviewed).toBe(false)
  })

  it('PATCH { reviewed: true } flips it to true on both routes', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'flip-1', 'Flip One')

    const patched = (await app.inject({
      method: 'PATCH', url: '/api/people/flip-1', headers: { cookie }, payload: { reviewed: true },
    })).json<{ reviewed: boolean }>()
    expect(patched.reviewed).toBe(true)

    const detail = (await app.inject({
      method: 'GET', url: '/api/people/flip-1', headers: { cookie },
    })).json<{ reviewed: boolean }>()
    expect(detail.reviewed).toBe(true)

    const list = (await app.inject({
      method: 'GET', url: '/api/people?q=Flip', headers: { cookie },
    })).json<{ items: readonly { reviewed: boolean }[] }>()
    expect(list.items[0]?.reviewed).toBe(true)
  })

  it('?reviewed=false no longer lists a person once reviewed', async () => {
    booted = await bootAndLogin()
    const { app, served, cookie } = booted
    person(served.state.db, 'filter-1', 'Filter One')

    const before = (await app.inject({
      method: 'GET', url: '/api/people?q=Filter&reviewed=false', headers: { cookie },
    })).json<{ items: readonly { id: string }[] }>()
    expect(before.items.map((p) => p.id)).toEqual(['filter-1'])

    await app.inject({
      method: 'PATCH', url: '/api/people/filter-1', headers: { cookie }, payload: { reviewed: true },
    })

    const after = (await app.inject({
      method: 'GET', url: '/api/people?q=Filter&reviewed=false', headers: { cookie },
    })).json<{ items: readonly { id: string }[] }>()
    expect(after.items.map((p) => p.id)).toEqual([])
  })
})
