import { and, eq } from 'drizzle-orm'
import type { ChannelIdentity, Principal } from '@mycelo/septum'
import type { Db } from '../persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from '../persistence/schema.js'

export interface ResolveOptions {
  /** Assigned on first contact only. Absent means no role, which reproduces a plain refusal. */
  defaultRole?: string
  now?: () => Date
}

function loadPrincipal(db: Db, principalId: string): Principal {
  const row = db.select().from(principal).where(eq(principal.id, principalId)).get()
  if (row === undefined) throw new Error(`principal '${principalId}' vanished mid-resolution`)
  const identities = db
    .select({
      channel: channelIdentity.channel,
      externalId: channelIdentity.externalId,
      displayName: channelIdentity.displayName,
    })
    .from(channelIdentity)
    .where(eq(channelIdentity.principalId, principalId))
    .all()
  const roles = db
    .select({ name: role.name })
    .from(principalRole)
    .innerJoin(role, eq(role.id, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
  return {
    id: row.id,
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
    identities: identities.map((i) => ({
      channel: i.channel,
      externalId: i.externalId,
      ...(i.displayName === null ? {} : { displayName: i.displayName }),
    })),
    roles: roles.map((r) => r.name),
  }
}

/**
 * Channel identity to persisted principal, creating one on first contact (spec §5.3).
 * Runs before the command is parsed, so an admitted stranger is recorded even when the
 * message carries no command.
 */
export function resolvePrincipal(
  db: Db,
  identity: ChannelIdentity,
  options: ResolveOptions = {},
): Principal {
  const now = options.now ?? ((): Date => new Date())
  const existing = db
    .select({ principalId: channelIdentity.principalId, displayName: channelIdentity.displayName })
    .from(channelIdentity)
    .where(and(eq(channelIdentity.channel, identity.channel), eq(channelIdentity.externalId, identity.externalId)))
    .get()

  if (existing !== undefined) {
    const incoming = identity.displayName ?? null
    // Only on change: a rename must become visible, but every message must not write.
    if (incoming !== null && incoming !== existing.displayName) {
      db.update(channelIdentity)
        .set({ displayName: incoming })
        .where(and(eq(channelIdentity.channel, identity.channel), eq(channelIdentity.externalId, identity.externalId)))
        .run()
    }
    return loadPrincipal(db, existing.principalId)
  }

  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(principal).values({
      id,
      ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
      createdAt: now(),
    }).run()
    tx.insert(channelIdentity).values({
      channel: identity.channel,
      externalId: identity.externalId,
      principalId: id,
      ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
      firstSeenAt: now(),
    }).run()
    if (options.defaultRole !== undefined) {
      const found = tx.select({ id: role.id }).from(role).where(eq(role.name, options.defaultRole)).get()
      if (found === undefined) {
        throw new Error(`default role '${options.defaultRole}' does not exist`)
      }
      tx.insert(principalRole).values({ principalId: id, roleId: found.id }).run()
    }
  })
  return loadPrincipal(db, id)
}

export function patternsOf(db: Db, principalId: string): readonly string[] {
  return db
    .select({ pattern: roleCommand.pattern })
    .from(principalRole)
    .innerJoin(roleCommand, eq(roleCommand.roleId, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
    .map((r) => r.pattern)
}
