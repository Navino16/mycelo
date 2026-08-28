import { and, eq } from 'drizzle-orm'
import { commandAlias } from '../persistence/schema.js'
import type { Db } from '../persistence/db.js'
import { COMMAND_NAME } from './parse.js'

/** Keyed `plugin.command`, which is what buildRoutes looks an alias up by (spec §3.3). */
export function listAliases(db: Db): ReadonlyMap<string, string> {
  return new Map(db.select().from(commandAlias).all()
    .map((row) => [`${row.pluginName}.${row.command}`, row.alias]))
}

/** The core's own class, so the route can tell a refusal from a fault it must not relabel. */
export class AliasRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AliasRefused'
  }
}

/**
 * Whether `plugin.command` names a command is not checked here: no table holds a command, and
 * only a manifest on disk can answer it (spec §3.4). The unique index would refuse a duplicate
 * alias with a SQLite constraint error, so the reader's guard is repeated as a sentence.
 */
export function setAlias(db: Db, plugin: string, command: string, alias: string): void {
  if (!COMMAND_NAME.test(alias)) {
    throw new AliasRefused(`alias '${alias}' is not a name a caller could type`)
  }
  const held = db.select().from(commandAlias).where(eq(commandAlias.alias, alias)).get()
  if (held !== undefined && (held.pluginName !== plugin || held.command !== command)) {
    throw new AliasRefused(`alias '${alias}' already renames '${held.pluginName}.${held.command}'`)
  }
  db.insert(commandAlias)
    .values({ pluginName: plugin, command, alias })
    .onConflictDoUpdate({
      target: [commandAlias.pluginName, commandAlias.command],
      set: { alias },
    })
    .run()
}

/** False when no alias was held, so a caller can tell a removal from a no-op. */
export function clearAlias(db: Db, plugin: string, command: string): boolean {
  const target = and(eq(commandAlias.pluginName, plugin), eq(commandAlias.command, command))
  if (db.select().from(commandAlias).where(target).get() === undefined) return false
  db.delete(commandAlias).where(target).run()
  return true
}
