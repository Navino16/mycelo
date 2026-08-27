import { describe, expect, it } from 'bun:test'
import { recordInstall, removeInstall } from '../../src/config/store.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Db } from '../../src/persistence/db.js'
import { clearAlias, listAliases, setAlias } from '../../src/rhizomorph/aliases.js'

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  recordInstall(db, 'help', 'enzyme')
  recordInstall(db, 'helpdesk', 'enzyme')
  return db
}

describe('the alias store', () => {
  it('keys an alias by plugin.command, which is what buildRoutes looks up', () => {
    const db = fresh()

    setAlias(db, 'help', 'help', 'aide')

    expect([...listAliases(db)]).toEqual([['help.help', 'aide']])
  })

  // The cardinality shape phases 5.5 and 5.6 both paid for: with one row, a listAliases that
  // returned only its last entry would pass.
  it('lists every alias, not the last one written', () => {
    const db = fresh()

    setAlias(db, 'help', 'help', 'aide')
    setAlias(db, 'helpdesk', 'links', 'liens')

    expect(new Map(listAliases(db))).toEqual(new Map([
      ['help.help', 'aide'],
      ['helpdesk.links', 'liens'],
    ]))
  })

  it('refuses an alias no caller could type, naming it', () => {
    const db = fresh()

    expect(() => { setAlias(db, 'help', 'help', 'Aide!') })
      .toThrow("alias 'Aide!' is not a name a caller could type")
    expect([...listAliases(db)]).toEqual([])
  })

  it('refuses an alias another command already holds, naming that command', () => {
    const db = fresh()
    setAlias(db, 'help', 'help', 'aide')

    expect(() => { setAlias(db, 'helpdesk', 'links', 'aide') })
      .toThrow("alias 'aide' already renames 'help.help'")
    // The stored value survives the refusal.
    expect([...listAliases(db)]).toEqual([['help.help', 'aide']])
  })

  it('allows the same alias to be written again on the command that holds it', () => {
    const db = fresh()
    setAlias(db, 'help', 'help', 'aide')

    setAlias(db, 'help', 'help', 'aide')

    expect([...listAliases(db)]).toEqual([['help.help', 'aide']])
  })

  it('replaces the alias of a command that already had one', () => {
    const db = fresh()
    setAlias(db, 'help', 'help', 'aide')

    setAlias(db, 'help', 'help', 'secours')

    expect([...listAliases(db)]).toEqual([['help.help', 'secours']])
  })

  it('reports whether it removed anything, so a no-op is not a removal', () => {
    const db = fresh()
    setAlias(db, 'help', 'help', 'aide')

    expect(clearAlias(db, 'help', 'help')).toBe(true)
    expect(clearAlias(db, 'help', 'help')).toBe(false)
    expect([...listAliases(db)]).toEqual([])
  })

  // The neighbour is a second command of the SAME plugin. With two aliases on two different
  // plugins, a DELETE that lost its command clause still leaves the neighbour standing and
  // this test passes — measured, and it is the shape phase 5.5 named and did not close.
  it('clears only the command named, leaving its plugin\'s other alias alone', () => {
    const db = fresh()
    setAlias(db, 'helpdesk', 'links', 'liens')
    setAlias(db, 'helpdesk', 'rules', 'regles')

    clearAlias(db, 'helpdesk', 'links')

    expect([...listAliases(db)]).toEqual([['helpdesk.rules', 'regles']])
  })

  // spec §3.2: a renamed command belongs to the install that declared it, so uninstalling
  // must not leave a row renaming a command nobody declares.
  it('loses an alias when its plugin is uninstalled', () => {
    const db = fresh()
    setAlias(db, 'help', 'help', 'aide')
    setAlias(db, 'helpdesk', 'links', 'liens')

    removeInstall(db, 'help')

    expect([...listAliases(db)]).toEqual([['helpdesk.links', 'liens']])
  })
})
