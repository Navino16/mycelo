import { and, eq } from 'drizzle-orm'
import type { OwnerIdentity } from '../config.js'
import type { Db } from '../persistence/db.js'
import { channelIdentity, principal, principalRole, role, roleCommand } from '../persistence/schema.js'

export class StartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StartupError'
  }
}

export interface BootstrapIdentityOptions {
  owner?: OwnerIdentity
  defaultRole?: string
  now?: () => Date
}

const OWNER_ROLE = 'owner'

function ensureOwnerRole(db: Db): string {
  const existing = db.select({ id: role.id }).from(role).where(eq(role.name, OWNER_ROLE)).get()
  const id = existing?.id ?? crypto.randomUUID()
  if (existing === undefined) {
    db.insert(role).values({ id, name: OWNER_ROLE, builtin: true }).run()
  }
  db.insert(roleCommand).values({ roleId: id, pattern: '*' }).onConflictDoNothing().run()
  return id
}

function ensureOwnerPrincipal(db: Db, owner: OwnerIdentity, now: () => Date): string {
  const existing = db
    .select({ principalId: channelIdentity.principalId })
    .from(channelIdentity)
    .where(and(eq(channelIdentity.channel, owner.channel), eq(channelIdentity.externalId, owner.userId)))
    .get()
  if (existing !== undefined) return existing.principalId
  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(principal).values({ id, createdAt: now() }).run()
    tx.insert(channelIdentity).values({
      channel: owner.channel,
      externalId: owner.userId,
      principalId: id,
      firstSeenAt: now(),
    }).run()
  })
  return id
}

/**
 * Reapplied every boot, so an operator who locks themselves out recovers by editing
 * mycelo.yaml (design §8.1). The owner role is created before defaultRole is validated,
 * which is what makes `defaultRole: owner` legal.
 */
export function bootstrapIdentity(db: Db, options: BootstrapIdentityOptions): void {
  const now = options.now ?? ((): Date => new Date())
  if (options.owner !== undefined) {
    const roleId = ensureOwnerRole(db)
    const principalId = ensureOwnerPrincipal(db, options.owner, now)
    db.insert(principalRole).values({ principalId, roleId }).onConflictDoNothing().run()
  }
  if (options.defaultRole !== undefined) {
    const found = db.select({ id: role.id }).from(role).where(eq(role.name, options.defaultRole)).get()
    if (found === undefined) {
      // Creating it empty would be safe but silently ineffective: someone would believe
      // they had granted rights nobody holds (spec §5.1).
      throw new StartupError(
        `defaultRole '${options.defaultRole}' names no existing role; create it or remove the key`,
      )
    }
  }
}
