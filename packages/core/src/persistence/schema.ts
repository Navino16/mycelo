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

// `name` is the primary key: a spore name is already unique across the substrate and every
// lookup in phase 5 is by name. The sporangium columns of spec §9.3 arrive with phase 8.
export const pluginInstall = sqliteTable('plugin_install', {
  name: text('name').primaryKey(),
  kind: text('kind').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  installedAt: integer('installed_at', { mode: 'timestamp_ms' }).notNull(),
})

// One row per setting rather than a JSON blob: `is_secret` is per key, and the phase 9 form
// masks fields one at a time.
export const pluginSetting = sqliteTable(
  'plugin_setting',
  {
    pluginName: text('plugin_name').notNull()
      .references(() => pluginInstall.name, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.pluginName, t.key] })],
)

// No message is ever stored: this exists so an operator can designate a broadcast target
// by a readable name instead of an opaque conversation id.
export const conversation = sqliteTable(
  'conversation',
  {
    channel: text('channel').notNull(),
    conversationId: text('conversation_id').notNull(),
    kind: text('kind', { enum: ['dm', 'group'] }).notNull(),
    /** Denormalised: a DM exposes no join between its conversation id and the sender's identity. */
    label: text('label'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.conversationId] })],
)

// Deliberately no foreign key to `conversation`: an operator may register a conversation
// the bot has not seen yet, which is the only way to broadcast into a silent group.
export const broadcastTarget = sqliteTable(
  'broadcast_target',
  {
    channel: text('channel').notNull(),
    conversationId: text('conversation_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.conversationId] })],
)

// `where` is a SQL keyword; the column is `where_kind`, exposed as `whereKind` here.
// Only septum's `ContextRule.where` reads as `where`.
export const commandContextRule = sqliteTable('command_context_rule', {
  pattern: text('pattern').primaryKey(),
  whereKind: text('where_kind', { enum: ['dm', 'group'] }).notNull(),
})

// No row for a plugin means every channel: an operator opts into confinement, never out of it.
export const inhibitorChannel = sqliteTable(
  'inhibitor_channel',
  {
    pluginName: text('plugin_name').notNull()
      .references(() => pluginInstall.name, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pluginName, t.channel] })],
)
