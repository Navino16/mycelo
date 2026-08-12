import { describe, expect, it } from 'bun:test'
import { MYCELIUM_SCOPES } from '../src/mycelium.js'
import type {
  PrincipalsManage,
  PrincipalsRead,
  RoleInfo,
  RolesAssign,
  RolesManage,
  RolesRead,
} from '../src/mycelium.js'
import type { Principal } from '../src/context.js'

const alice: Principal = { id: 'p1', displayName: 'alice', identities: [], roles: ['owner'] }

describe('the mycelium scope interfaces', () => {
  it('lets an implementation of principals.read satisfy the type', async () => {
    const api: PrincipalsRead = {
      listPrincipals: () => Promise.resolve([alice]),
      getPrincipal: (id) => Promise.resolve(id === 'p1' ? alice : null),
      findByIdentity: (channel, externalId) =>
        Promise.resolve(channel === 'console' && externalId === 'alice' ? alice : null),
    }
    expect(await api.getPrincipal('p1')).toEqual(alice)
    expect(await api.getPrincipal('nobody')).toBeNull()
    expect(await api.findByIdentity('console', 'alice')).toEqual(alice)
  })

  it('lets an implementation of the four remaining interfaces satisfy the types', async () => {
    const calls: string[] = []
    const manage: PrincipalsManage = {
      markReviewed: (id) => { calls.push(`reviewed:${id}`); return Promise.resolve() },
      setDisplayName: (id, name) => { calls.push(`name:${id}:${name}`); return Promise.resolve() },
    }
    const owner: RoleInfo = { name: 'owner', patterns: ['*'], builtin: true }
    const read: RolesRead = {
      listRoles: () => Promise.resolve([owner]),
      rolesOf: () => Promise.resolve(['owner']),
    }
    const assign: RolesAssign = {
      assignRole: (p, r) => { calls.push(`assign:${p}:${r}`); return Promise.resolve() },
      revokeRole: (p, r) => { calls.push(`revoke:${p}:${r}`); return Promise.resolve() },
    }
    const rolesManage: RolesManage = {
      createRole: (name) => { calls.push(`create:${name}`); return Promise.resolve() },
      setRoleCommands: (name) => { calls.push(`set:${name}`); return Promise.resolve() },
      deleteRole: (name) => { calls.push(`delete:${name}`); return Promise.resolve() },
    }
    await manage.markReviewed('p1')
    await manage.setDisplayName('p1', 'Alice')
    await assign.assignRole('p1', 'owner')
    await assign.revokeRole('p1', 'owner')
    await rolesManage.createRole('guest', ['media.*'])
    await rolesManage.setRoleCommands('guest', ['media.movies'])
    await rolesManage.deleteRole('guest')
    expect(calls).toEqual([
      'reviewed:p1', 'name:p1:Alice', 'assign:p1:owner', 'revoke:p1:owner',
      'create:guest', 'set:guest', 'delete:guest',
    ])
    expect((await read.listRoles())[0]?.builtin).toBe(true)
    expect(await read.rolesOf('p1')).toEqual(['owner'])
  })

  it('still declares exactly nine scopes, eight of which now have an interface', () => {
    expect(MYCELIUM_SCOPES).toHaveLength(9)
    expect(MYCELIUM_SCOPES).toContain('principals.read')
    expect(MYCELIUM_SCOPES).toContain('roles.manage')
  })
})
