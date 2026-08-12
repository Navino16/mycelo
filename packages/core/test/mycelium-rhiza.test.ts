import { describe, expect, it } from 'bun:test'
import type {
  HealthRead, PluginsRead, PrincipalsManage, PrincipalsRead, RolesAssign, RolesManage, RolesRead,
} from '@mycelo/septum'
import { bootstrapIdentity } from '../src/identity/bootstrap.js'
import { resolvePrincipal } from '../src/identity/resolve.js'
import type { Registry } from '../src/germination/registry.js'
import { createMyceliumApi } from '../src/mycelium-rhiza.js'
import { migrateDatabase, openDatabase } from '../src/persistence/db.js'
import type { Db } from '../src/persistence/db.js'
import { principal } from '../src/persistence/schema.js'

const stubSend = async () => {}
const noSend = stubSend

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

function emptyRegistry(): Registry {
  return { hyphae: [], rhizas: [], enzymes: [], dormant: [], routes: new Map(), order: [] }
}

const registry = {
  hyphae: [], rhizas: [], dormant: [{ name: 'broken', reason: 'create() returned no api' }],
  enzymes: [{ name: 'media', manifest: { kind: 'enzyme', name: 'media', septum: '^0.4',
    commands: [{ name: 'movies', description: 'x', code: 'h' }] }, instance: null }],
  routes: new Map(),
} as unknown as Registry

it('mounts only what the scopes grant', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh())
  expect(typeof (api as PluginsRead).listPlugins).toBe('function')
  expect('send' in api).toBe(false)
  expect('health' in api).toBe(false)
})

it('does not mount listPlugins when plugins.read is not granted', () => {
  expect('listPlugins' in createMyceliumApi(registry, ['health.read'], stubSend, fresh())).toBe(false)
})

it('lists germinated and dormant plugins with their reasons', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh()) as PluginsRead
  expect(api.listPlugins()).toEqual([
    { name: 'media', kind: 'enzyme', commands: ['movies'], state: 'germinated' },
    { name: 'broken', commands: [], state: 'dormant', reason: 'create() returned no api' },
  ])
})

it('omits kind for a dormant plugin rather than inventing one, since none was ever known', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh()) as PluginsRead
  const broken = api.listPlugins().find((p) => p.name === 'broken')
  expect(broken).toBeDefined()
  expect(broken).not.toHaveProperty('kind')
})

it('aggregates each germinated rhiza health', async () => {
  const checkedAt = new Date(0)
  const withRhiza = { ...registry, rhizas: [{ name: 'mock', manifest: {},
    instance: { health: async () => ({ state: 'healthy', checkedAt }) } }] } as unknown as Registry
  const api = createMyceliumApi(withRhiza, ['health.read'], stubSend, fresh()) as HealthRead
  expect(await api.health()).toEqual([{ rhiza: 'mock', status: { state: 'healthy', checkedAt } }])
})

describe('createMyceliumApi, the phase 4 scopes', () => {
  it('mounts no principal or role method when no scope grants it', () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, fresh())
    for (const method of [
      'listPrincipals', 'getPrincipal', 'findByIdentity', 'markReviewed', 'setDisplayName',
      'listRoles', 'rolesOf', 'assignRole', 'revokeRole', 'createRole', 'setRoleCommands', 'deleteRole',
    ]) {
      expect(method in api).toBe(false)
    }
  })

  it('mounts principals.read alone without principals.manage', () => {
    const api = createMyceliumApi(emptyRegistry(), ['principals.read'], noSend, fresh())
    expect('listPrincipals' in api).toBe(true)
    expect('markReviewed' in api).toBe(false)
  })

  it('finds a principal by its channel identity', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    const api = createMyceliumApi(emptyRegistry(), ['principals.read'], noSend, db) as PrincipalsRead
    expect((await api.findByIdentity('console', 'alice'))?.id).toBe(p.id)
    expect(await api.findByIdentity('console', 'nobody')).toBeNull()
  })

  it('assigns and revokes a role by name', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db) as RolesAssign
    const read = createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db) as RolesRead
    await manage.createRole('guest', ['media.*'])
    await assign.assignRole(p.id, 'guest')
    expect(await read.rolesOf(p.id)).toEqual(['guest'])
    await assign.revokeRole(p.id, 'guest')
    expect(await read.rolesOf(p.id)).toEqual([])
  })

  it('rejects assigning a role that does not exist', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db) as RolesAssign
    expect(assign.assignRole(p.id, 'ghost')).rejects.toThrow()
  })

  it('refuses to delete or rewrite a builtin role', async () => {
    const db = fresh()
    bootstrapIdentity(db, { owner: { channel: 'console', userId: 'alice' } })
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    expect(manage.deleteRole('owner')).rejects.toThrow(/builtin/)
    expect(manage.setRoleCommands('owner', ['media.*'])).rejects.toThrow(/builtin/)
  })

  it('replaces a role\'s patterns wholesale rather than appending', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    const read = createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db) as RolesRead
    await manage.createRole('guest', ['media.*', 'admin.plugins'])
    await manage.setRoleCommands('guest', ['media.movies'])
    expect((await read.listRoles()).find((r) => r.name === 'guest')?.patterns).toEqual(['media.movies'])
  })

  it('marks a principal reviewed and renames it', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'carol' })
    const api = createMyceliumApi(emptyRegistry(), ['principals.manage', 'principals.read'], noSend, db) as
      PrincipalsManage & PrincipalsRead
    await api.markReviewed(p.id)
    await api.setDisplayName(p.id, 'Carol')
    expect((await api.getPrincipal(p.id))?.displayName).toBe('Carol')
    expect(db.select().from(principal).get()?.reviewedAt).toBeInstanceOf(Date)
  })
})
