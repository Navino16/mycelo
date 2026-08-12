import { describe, expect, it } from 'bun:test'
import type {
  HealthRead, PluginsRead, PrincipalsManage, PrincipalsRead, RolesAssign, RolesManage, RolesRead,
} from '@mycelo/septum'
import { bootstrapIdentity } from '../src/identity/bootstrap.js'
import { resolvePrincipal } from '../src/identity/resolve.js'
import type { Registry } from '../src/germination/registry.js'
import { MYCELIUM_SCOPES } from '@mycelo/septum'
import type { MyceliumScope } from '@mycelo/septum'
import { MOUNTABLE_SCOPES, resolve } from '../src/germination/anastomoses.js'
import { createMyceliumApi } from '../src/mycelium-rhiza.js'
import { migrateDatabase, openDatabase } from '../src/persistence/db.js'
import type { Db } from '../src/persistence/db.js'
import { principal } from '../src/persistence/schema.js'
import { rejectsWith } from './support/rejects.js'

const stubSend = async () => {}
const noSend = stubSend

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

function emptyRegistry(): Registry {
  return { hyphae: [], rhizas: [], enzymes: [], inhibitors: [], dormant: [], routes: new Map(), order: [], brokenEnforcing: [] }
}

const registry = {
  hyphae: [], rhizas: [], inhibitors: [], dormant: [{ name: 'broken', reason: 'create() returned no api' }],
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

it('lists a germinated inhibitor with an empty command list', () => {
  const withInhibitor = {
    ...registry,
    inhibitors: [{ name: 'gate', manifest: { kind: 'inhibitor', name: 'gate', septum: '^0.5', enforcing: true } }],
  } as unknown as Registry
  const api = createMyceliumApi(withInhibitor, ['plugins.read'], stubSend, fresh()) as PluginsRead
  expect(api.listPlugins()).toContainEqual({ name: 'gate', kind: 'inhibitor', commands: [], state: 'germinated' })
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
    await rejectsWith(assign.assignRole(p.id, 'ghost'), /ghost/)
  })

  it('refuses to delete or rewrite a builtin role', async () => {
    const db = fresh()
    bootstrapIdentity(db, { owner: { channel: 'console', userId: 'alice' } })
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    await rejectsWith(manage.deleteRole('owner'), /builtin/)
    await rejectsWith(manage.setRoleCommands('owner', ['media.*']), /builtin/)
  })

  it('rejects deleting a role that does not exist, naming it', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    await rejectsWith(manage.deleteRole('typo'), /typo/)
  })

  it('rejects rewriting a role that does not exist, naming it', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    await rejectsWith(manage.setRoleCommands('typo', ['media.*']), /typo/)
  })

  it('replaces a role\'s patterns wholesale rather than appending', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    const read = createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db) as RolesRead
    await manage.createRole('guest', ['media.*', 'admin.plugins'])
    await manage.setRoleCommands('guest', ['media.movies'])
    expect((await read.listRoles()).find((r) => r.name === 'guest')?.patterns).toEqual(['media.movies'])
  })

  it('does not let Object.prototype pollution forge an ungranted scope', () => {
    // A caller probes for a scope with `in`, so a polluted prototype must not answer for it.
    Object.defineProperty(Object.prototype, 'assignRole', { value: () => {}, configurable: true, enumerable: false })
    try {
      const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, fresh())
      expect('assignRole' in api).toBe(false)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'assignRole')
    }
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

// The worst defect of phase 4 was a scope mounted in one place and gated in the other, and
// it was found by a fixture rather than a test. Phase 5's plugins.toggle walks the same path.
describe('MOUNTABLE_SCOPES against what createMyceliumApi actually mounts', () => {
  // Every scope MYCELIUM_SCOPES carries that no phase mounts yet. Mounting one means
  // deleting its entry here and adding it to MOUNTABLE_SCOPES in the same commit.
  const GATED: readonly MyceliumScope[] = ['plugins.toggle']

  it('mounts exactly the scopes MOUNTABLE_SCOPES declares, and gates the rest', () => {
    const mounted = MYCELIUM_SCOPES.filter((scope) => {
      const api = createMyceliumApi(emptyRegistry(), [scope], noSend, fresh())
      return Object.keys(api).length > 0
    })
    expect(new Set(mounted)).toEqual(new Set(MOUNTABLE_SCOPES))
    const mountable = new Set<MyceliumScope>(MOUNTABLE_SCOPES)
    expect(MYCELIUM_SCOPES.filter((s) => !mountable.has(s))).toEqual([...GATED])
  })

  it('leaves a spore dormant for every scope it does not mount', () => {
    for (const scope of GATED) {
      const r = resolve([{
        location: { directory: 'toggler', manifestPath: 'toggler/spore.yaml' },
        manifest: {
          kind: 'enzyme', name: 'toggler', septum: '^0.5',
          commands: [{ name: 'toggler', description: 'x', respond: 'hi' }],
          requires: [{ rhiza: 'mycelium', scopes: [scope] }],
        },
      }] as unknown as Parameters<typeof resolve>[0])
      expect(r.order).toEqual([])
      expect(r.dormant[0]?.reason).toContain(`scope '${scope}'`)
    }
  })

  it('grants every mountable scope without leaving the spore dormant', () => {
    for (const scope of MOUNTABLE_SCOPES) {
      const r = resolve([{
        location: { directory: 'user', manifestPath: 'user/spore.yaml' },
        manifest: {
          kind: 'enzyme', name: 'user', septum: '^0.5',
          commands: [{ name: 'user', description: 'x', respond: 'hi' }],
          requires: [{ rhiza: 'mycelium', scopes: [scope] }],
        },
      }] as unknown as Parameters<typeof resolve>[0])
      expect(r.dormant).toEqual([])
      expect(r.order[0]?.scopes).toEqual([scope])
    }
  })
})

// Curated diagnostics, not raw SQLite: /role-new answered "command 'role-new' failed" for
// a duplicate name or a repeated pattern, and the three silent resolves named nothing.
describe('rejections a caller can act on', () => {
  it('rejects creating a role whose name is taken, or empty', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    await manage.createRole('guest', ['media.*'])
    await rejectsWith(manage.createRole('guest', ['admin.*']), /'guest' already exists/)
    await rejectsWith(manage.createRole('', []), /cannot be empty/)
    expect(await (createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db) as RolesRead).listRoles())
      .toHaveLength(1)
  })

  it('rejects a pattern listed twice in one call, on create and on rewrite', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db) as RolesManage
    await rejectsWith(manage.createRole('guest', ['media.*', 'media.*']), /'media.\*' is listed twice/)
    await manage.createRole('guest', ['media.*'])
    await rejectsWith(manage.setRoleCommands('guest', ['admin.*', 'admin.*']), /listed twice/)
  })

  it('rejects markReviewed, setDisplayName, assignRole and revokeRole for an unknown principal', async () => {
    const db = fresh()
    bootstrapIdentity(db, { owner: { channel: 'console', userId: 'alice' } })
    const manage = createMyceliumApi(emptyRegistry(), ['principals.manage'], noSend, db) as PrincipalsManage
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db) as RolesAssign
    await rejectsWith(manage.markReviewed('nobody'), /principal 'nobody' does not exist/)
    await rejectsWith(manage.setDisplayName('nobody', 'X'), /principal 'nobody' does not exist/)
    await rejectsWith(assign.assignRole('nobody', 'owner'), /principal 'nobody' does not exist/)
    await rejectsWith(assign.revokeRole('nobody', 'owner'), /principal 'nobody' does not exist/)
  })

  it('still reports an unknown role before an unknown principal, so the first fault named is the caller\'s', async () => {
    const db = fresh()
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db) as RolesAssign
    await rejectsWith(assign.assignRole('nobody', 'ghost'), /role 'ghost'/)
  })
})
