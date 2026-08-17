import { describe, expect, it } from 'bun:test'
import { isRefusal } from '../../src/authorization/refusal.js'
import { assignRole, createRole, deleteRole, setRoleCommands } from '../../src/authorization/roles.js'
import { requirePrincipal } from '../../src/identity/people.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { role } from '../../src/persistence/schema.js'
import type { Db } from '../../src/persistence/db.js'

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

function builtinRole(db: Db, name: string): void {
  db.insert(role).values({ id: crypto.randomUUID(), name, builtin: true }).run()
}

/** Fails loudly if `fn` does not throw, so a passing test proves a refusal happened. */
function thrown(fn: () => void): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected a throw, but the call succeeded')
}

// One test per RefusalCode: the codes are the mapping this task exists to pin, not
// only the unchanged messages that surround them.
describe('the authorization store throws a StoreRefusal with the right code', () => {
  it('role-unknown', () => {
    const { db, close } = fresh()
    expect(isRefusal(thrown(() => { assignRole(db, 'nobody', 'ghost') }), 'role-unknown')).toBe(true)
    close()
  })

  it('role-exists', () => {
    const { db, close } = fresh()
    createRole(db, 'guest', [])
    expect(isRefusal(thrown(() => { createRole(db, 'guest', []) }), 'role-exists')).toBe(true)
    close()
  })

  it('role-builtin', () => {
    const { db, close } = fresh()
    builtinRole(db, 'owner')
    expect(isRefusal(thrown(() => { setRoleCommands(db, 'owner', ['media.*']) }), 'role-builtin')).toBe(true)
    close()
  })

  it('role-is-default', () => {
    const { db, close } = fresh()
    createRole(db, 'newcomer', [])
    expect(isRefusal(thrown(() => { deleteRole(db, 'newcomer', 'newcomer') }), 'role-is-default')).toBe(true)
    close()
  })

  it('role-name-empty', () => {
    const { db, close } = fresh()
    expect(isRefusal(thrown(() => { createRole(db, '', []) }), 'role-name-empty')).toBe(true)
    close()
  })

  it('pattern-duplicate', () => {
    const { db, close } = fresh()
    expect(isRefusal(thrown(() => { createRole(db, 'guest', ['media.*', 'media.*']) }), 'pattern-duplicate'))
      .toBe(true)
    close()
  })

  it('principal-unknown', () => {
    const { db, close } = fresh()
    expect(isRefusal(thrown(() => { requirePrincipal(db, 'nobody') }), 'principal-unknown')).toBe(true)
    close()
  })
})
