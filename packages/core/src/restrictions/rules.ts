import { asc, eq } from 'drizzle-orm'
import type { ContextRule, ConversationKind } from '@mycelo/septum'
import { getInstall } from '../config/store.js'
import type { Db } from '../persistence/db.js'
import { commandContextRule, inhibitorChannel } from '../persistence/schema.js'

const NAME = '[a-z][a-z0-9-]*'
const PATTERN_FORMS = new RegExp(`^(\\*|${NAME}\\.\\*|${NAME}\\.${NAME})$`)

export function listContextRules(db: Db): readonly ContextRule[] {
  return db.select().from(commandContextRule)
    .orderBy(asc(commandContextRule.pattern))
    .all()
    .map((row) => ({ pattern: row.pattern, where: row.whereKind }))
}

/**
 * Validated on write, unlike a role pattern: a role pattern that matches nothing fails
 * closed, while a context rule that matches nothing silently removes the restriction.
 */
export function setContextRule(db: Db, pattern: string, where: ConversationKind): void {
  if (!PATTERN_FORMS.test(pattern)) {
    throw new Error(`pattern '${pattern}' is not one of '*', '<plugin>.*' or '<plugin>.<command>'`)
  }
  db.insert(commandContextRule)
    .values({ pattern, whereKind: where })
    .onConflictDoUpdate({ target: commandContextRule.pattern, set: { whereKind: where } })
    .run()
}

export function clearContextRule(db: Db, pattern: string): void {
  db.delete(commandContextRule).where(eq(commandContextRule.pattern, pattern)).run()
}

/**
 * The most specific matching rule wins: exact, then `plugin.*`, then `*`. A less specific
 * rule must not override the one the operator wrote for a single command.
 */
/**
 * The rule table read once, as a resolver. available() asks per command over 100+ commands,
 * and contextRuleFor's per-call listContextRules() would be one full read each.
 */
export function contextRules(db: Db): (qualified: string) => ConversationKind | null {
  const rules = new Map(listContextRules(db).map((r) => [r.pattern, r.where]))
  return (qualified) => {
    const dot = qualified.indexOf('.')
    const plugin = dot === -1 ? qualified : qualified.slice(0, dot)
    return rules.get(qualified) ?? rules.get(`${plugin}.*`) ?? rules.get('*') ?? null
  }
}

export function contextRuleFor(db: Db, qualified: string): ConversationKind | null {
  return contextRules(db)(qualified)
}

export function inhibitorChannels(db: Db, name: string): readonly string[] {
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  return db.select({ channel: inhibitorChannel.channel })
    .from(inhibitorChannel)
    .where(eq(inhibitorChannel.pluginName, name))
    .orderBy(asc(inhibitorChannel.channel))
    .all()
    .map((row) => row.channel)
}

export function setInhibitorChannels(db: Db, name: string, channels: readonly string[]): void {
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  db.transaction((tx) => {
    tx.delete(inhibitorChannel).where(eq(inhibitorChannel.pluginName, name)).run()
    for (const channel of new Set(channels)) {
      tx.insert(inhibitorChannel).values({ pluginName: name, channel }).run()
    }
  })
}

/** One query for the whole admission chain: a per-inhibitor read would be one query per message per inhibitor. */
export function allInhibitorChannels(db: Db): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>()
  for (const row of db.select().from(inhibitorChannel).orderBy(asc(inhibitorChannel.channel)).all()) {
    const existing = map.get(row.pluginName)
    if (existing === undefined) map.set(row.pluginName, [row.channel])
    else existing.push(row.channel)
  }
  return map
}
