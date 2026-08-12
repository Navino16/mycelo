import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const principal = sqliteTable('principal', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  /** Null means never reviewed by a human: a list filter, not an alert (spec §5.3). */
  reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// (channel, external_id) is the natural key and the per-message lookup; a surrogate
// id would be a second index for nothing.
export const channelIdentity = sqliteTable(
  'channel_identity',
  {
    channel: text('channel').notNull(),
    externalId: text('external_id').notNull(),
    principalId: text('principal_id').notNull().references(() => principal.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.externalId] })],
)

export const role = sqliteTable('role', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
})

// Patterns are rows, not a JSON array: roles.read lists them and the phase 9 UI ticks
// them one at a time.
export const roleCommand = sqliteTable(
  'role_command',
  {
    roleId: text('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.pattern] })],
)

export const principalRole = sqliteTable(
  'principal_role',
  {
    principalId: text('principal_id').notNull().references(() => principal.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.roleId] })],
)
