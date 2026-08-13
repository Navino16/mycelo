import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { RolesManage } from '@mycelo/septum'
import type { Registry } from '../../src/germination/registry.js'
import { createMyceliumApi } from '../../src/mycelium-rhiza.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Db } from '../../src/persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from '../../src/persistence/schema.js'
import { StartupError, bootstrapIdentity } from '../../src/identity/bootstrap.js'
import { rejectsWith } from '../support/rejects.js'

const noSend = async () => {}
const SPORES = resolvePath(import.meta.dirname, '../../../../fixtures')

function emptyRegistry(): Registry {
  return {
    hyphae: [], rhizas: [], enzymes: [], inhibitors: [], dormant: [],
    routes: new Map(), order: [], brokenEnforcing: [],
  }
}

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

const owner = { channel: 'console', userId: 'alice' }

describe('bootstrapIdentity', () => {
  it('creates the owner role with the global wildcard, marked builtin', () => {
    const db = fresh()
    bootstrapIdentity(db, { owner })
    const row = db.select().from(role).where(eq(role.name, 'owner')).get()
    expect(row?.builtin).toBe(true)
    expect(db.select({ p: roleCommand.pattern }).from(roleCommand).all().map((r) => r.p)).toEqual(['*'])
  })

  it('creates the owner principal and its channel identity', () => {
    const db = fresh()
    bootstrapIdentity(db, { owner })
    const identity = db.select().from(channelIdentity).get()
    expect(identity?.channel).toBe('console')
    expect(identity?.externalId).toBe('alice')
    expect(db.select().from(principalRole).all()).toHaveLength(1)
  })

  it('is idempotent across boots', () => {
    const db = fresh()
    bootstrapIdentity(db, { owner })
    bootstrapIdentity(db, { owner })
    bootstrapIdentity(db, { owner })
    expect(db.select().from(role).all()).toHaveLength(1)
    expect(db.select().from(principal).all()).toHaveLength(1)
    expect(db.select().from(principalRole).all()).toHaveLength(1)
    expect(db.select().from(roleCommand).all()).toHaveLength(1)
  })

  it('reassigns the owner role when it was revoked, so an operator recovers by rebooting', () => {
    const db = fresh()
    bootstrapIdentity(db, { owner })
    db.delete(principalRole).run()
    bootstrapIdentity(db, { owner })
    expect(db.select().from(principalRole).all()).toHaveLength(1)
  })

  it('restores the global wildcard when the owner role lost its pattern', () => {
    const db = fresh()
    bootstrapIdentity(db, { owner })
    db.delete(roleCommand).run()
    bootstrapIdentity(db, { owner })
    expect(db.select({ p: roleCommand.pattern }).from(roleCommand).all().map((r) => r.p)).toEqual(['*'])
  })

  it('does nothing when no owner is configured', () => {
    const db = fresh()
    bootstrapIdentity(db, {})
    expect(db.select().from(role).all()).toEqual([])
    expect(db.select().from(principal).all()).toEqual([])
  })

  it('refuses to start when defaultRole names a role that does not exist', () => {
    const db = fresh()
    expect(() => bootstrapIdentity(db, { owner, defaultRole: 'ghost' })).toThrow(StartupError)
  })

  it('accepts a defaultRole that exists', () => {
    const db = fresh()
    db.insert(role).values({ id: 'r:guest', name: 'guest' }).run()
    expect(() => bootstrapIdentity(db, { owner, defaultRole: 'guest' })).not.toThrow()
  })

  it('accepts owner as the defaultRole, since bootstrap creates it first', () => {
    const db = fresh()
    expect(() => bootstrapIdentity(db, { owner, defaultRole: 'owner' })).not.toThrow()
  })

  it('reuses an existing principal when the owner identity is already known', () => {
    const db = fresh()
    const now = new Date()
    db.insert(principal).values({ id: 'existing', createdAt: now }).run()
    db.insert(channelIdentity).values({
      channel: 'console', externalId: 'alice', principalId: 'existing', firstSeenAt: now,
    }).run()
    bootstrapIdentity(db, { owner })
    expect(db.select().from(principal).all()).toHaveLength(1)
    expect(db.select().from(principalRole).get()?.principalId).toBe('existing')
  })

  // Reachable: boot with no owner: block (design §8.1 allows it), let a spore holding
  // roles.manage create a plain role named 'owner', then add owner: and reboot.
  it('repairs the builtin flag on a role named owner that a spore created', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    bootstrapIdentity(db, {})
    await manage.createRole('owner', ['media.*'])
    expect(db.select().from(role).where(eq(role.name, 'owner')).get()?.builtin).toBe(false)

    bootstrapIdentity(db, { owner })
    expect(db.select().from(role).where(eq(role.name, 'owner')).get()?.builtin).toBe(true)
    // The guarantee design §2 makes: once builtin, neither call can undo it.
    await rejectsWith(manage.deleteRole('owner'), /builtin/)
    await rejectsWith(manage.setRoleCommands('owner', []), /builtin/)
    // Repaired, not replaced: one row, and the wildcard sits alongside what was there.
    expect(db.select().from(role).all()).toHaveLength(1)
    const patterns = db.select({ p: roleCommand.pattern }).from(roleCommand).all().map((r) => r.p)
    expect(new Set(patterns)).toEqual(new Set(['media.*', '*']))
  })
})
