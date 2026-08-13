import { and, eq } from 'drizzle-orm'
import type {
  FormSchema,
  HealthRead,
  MessagesSend,
  MyceliumScope,
  OutgoingContent,
  Principal,
  PluginInfo,
  PluginsConfigure,
  PluginsRead,
  PluginsToggle,
  PrincipalsManage,
  PrincipalsRead,
  PushTarget,
  RhizaHealth,
  RoleInfo,
  RolesAssign,
  RolesManage,
  RolesRead,
  SporeKind,
} from '@mycelo/septum'
import { formSchemaFor } from './config/jsonschema.js'
import { enablePlugin, findSpore, loadSporeModule } from './config/lifecycle.js'
import { getInstall, listInstalls, setEnabled, writeSetting } from './config/store.js'
import type { Registry } from './germination/registry.js'
import type { Db } from './persistence/db.js'
import { channelIdentity, pluginSetting, principal, principalRole, role, roleCommand } from './persistence/schema.js'
import { describeThrown } from './support/thrown.js'

// germinate.ts skips a disabled install before it can ever become a registry entry —
// germinated or dormant — so this is the only place that can still name it, and the only
// place that can name an install whose spore has gone from disk.
function listPlugins(registry: Registry, sporesDir: string, db?: Db): readonly PluginInfo[] {
  const germinated: PluginInfo[] = [
    ...registry.hyphae.map((h) => ({ name: h.name, kind: h.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
    ...registry.enzymes.map((e) => ({
      name: e.name,
      kind: e.manifest.kind,
      commands: e.manifest.commands.map((c) => c.name),
      state: 'germinated' as const,
      enabled: true,
    })),
    ...registry.rhizas.map((r) => ({ name: r.name, kind: r.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
    ...registry.inhibitors.map((i) => ({ name: i.name, kind: i.manifest.kind, commands: [], state: 'germinated' as const, enabled: true })),
  ]
  // Dormant carries no kind: a spore may fail before its manifest ever parses. `enabled`
  // is what germination saw, like every other entry here — an operator's later toggle is
  // only reflected by the next germination.
  const dormant: PluginInfo[] = registry.dormant.map((d) => ({
    name: d.name,
    commands: [],
    state: 'dormant' as const,
    reason: d.reason,
    enabled: true,
  }))
  const known = new Set([...germinated, ...dormant].map((p) => p.name))
  // install.kind came from manifest.kind at record time (lifecycle.ts), so widening it
  // back is not a real cast across the plugin boundary.
  const rest: PluginInfo[] = db === undefined ? [] : listInstalls(db)
    .filter((install) => !known.has(install.name))
    .flatMap((install): PluginInfo[] => {
      const base = { name: install.name, kind: install.kind as SporeKind, commands: [] }
      if (!install.enabled) return [{ ...base, state: 'disabled' as const, enabled: false }]
      // syncInstalls keeps the row of a spore whose directory has gone, so the operator
      // can recover it — which requires being able to see that it is still there.
      if (findSpore(sporesDir, install.name) !== undefined) return []
      return [{
        ...base,
        state: 'dormant' as const,
        reason: `no spore named '${install.name}' is present on disk`,
        enabled: true,
      }]
    })
  return [...germinated, ...dormant, ...rest]
}

async function aggregateHealth(registry: Registry): Promise<readonly RhizaHealth[]> {
  return Promise.all(registry.rhizas.map(async (r) => ({ rhiza: r.name, status: await r.instance.health() })))
}

function loadPrincipal(db: Db, principalId: string): Principal | null {
  const row = db.select().from(principal).where(eq(principal.id, principalId)).get()
  if (row === undefined) return null
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

function listPrincipals(db: Db): readonly Principal[] {
  return db.select({ id: principal.id }).from(principal).all().map((r) => {
    const p = loadPrincipal(db, r.id)
    if (p === null) throw new Error(`principal '${r.id}' vanished mid-listing`)
    return p
  })
}

function findByIdentity(db: Db, channel: string, externalId: string): Principal | null {
  const row = db
    .select({ principalId: channelIdentity.principalId })
    .from(channelIdentity)
    .where(and(eq(channelIdentity.channel, channel), eq(channelIdentity.externalId, externalId)))
    .get()
  return row === undefined ? null : loadPrincipal(db, row.principalId)
}

// An UPDATE matching no row is not an error in SQL, but it is a caller mistake here: the
// published contract says these reject rather than resolve for an id nobody holds.
function requirePrincipal(db: Db, id: string): void {
  const row = db.select({ id: principal.id }).from(principal).where(eq(principal.id, id)).get()
  if (row === undefined) throw new Error(`principal '${id}' does not exist`)
}

function markReviewed(db: Db, id: string): void {
  requirePrincipal(db, id)
  db.update(principal).set({ reviewedAt: new Date() }).where(eq(principal.id, id)).run()
}

function setDisplayName(db: Db, id: string, displayName: string): void {
  requirePrincipal(db, id)
  db.update(principal).set({ displayName }).where(eq(principal.id, id)).run()
}

function listRoles(db: Db): readonly RoleInfo[] {
  return db.select().from(role).all().map((r) => ({
    name: r.name,
    builtin: r.builtin,
    patterns: db.select({ pattern: roleCommand.pattern }).from(roleCommand)
      .where(eq(roleCommand.roleId, r.id)).all().map((p) => p.pattern),
  }))
}

function rolesOf(db: Db, principalId: string): readonly string[] {
  return db
    .select({ name: role.name })
    .from(principalRole)
    .innerJoin(role, eq(role.id, principalRole.roleId))
    .where(eq(principalRole.principalId, principalId))
    .all()
    .map((r) => r.name)
}

function findRole(db: Db, name: string): { id: string; builtin: boolean } | undefined {
  return db.select({ id: role.id, builtin: role.builtin }).from(role).where(eq(role.name, name)).get()
}

function assignRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new Error(`role '${roleName}' does not exist`)
  requirePrincipal(db, principalId)
  db.insert(principalRole).values({ principalId, roleId: found.id }).onConflictDoNothing().run()
}

function revokeRole(db: Db, principalId: string, roleName: string): void {
  const found = findRole(db, roleName)
  if (found === undefined) throw new Error(`role '${roleName}' does not exist`)
  requirePrincipal(db, principalId)
  db.delete(principalRole)
    .where(and(eq(principalRole.principalId, principalId), eq(principalRole.roleId, found.id)))
    .run()
}

// Curated like its three siblings: the raw SQLite UNIQUE and primary-key violations
// reached the user as "command 'role-new' failed", naming nothing.
function createRole(db: Db, name: string, patterns: readonly string[]): void {
  if (name === '') throw new Error('a role name cannot be empty')
  if (findRole(db, name) !== undefined) throw new Error(`role '${name}' already exists`)
  const duplicate = patterns.find((p, i) => patterns.indexOf(p) !== i)
  if (duplicate !== undefined) throw new Error(`pattern '${duplicate}' is listed twice`)
  const id = crypto.randomUUID()
  db.transaction((tx) => {
    tx.insert(role).values({ id, name }).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: id, pattern }).run()
  })
}

function setRoleCommands(db: Db, name: string, patterns: readonly string[]): void {
  const found = findRole(db, name)
  if (found === undefined) throw new Error(`role '${name}' does not exist`)
  if (found.builtin) throw new Error(`role '${name}' is builtin and cannot be rewritten`)
  const duplicate = patterns.find((p, i) => patterns.indexOf(p) !== i)
  if (duplicate !== undefined) throw new Error(`pattern '${duplicate}' is listed twice`)
  db.transaction((tx) => {
    tx.delete(roleCommand).where(eq(roleCommand.roleId, found.id)).run()
    for (const pattern of patterns) tx.insert(roleCommand).values({ roleId: found.id, pattern }).run()
  })
}

function deleteRole(db: Db, name: string, defaultRole?: string): void {
  const found = findRole(db, name)
  if (found === undefined) throw new Error(`role '${name}' does not exist`)
  if (found.builtin) throw new Error(`role '${name}' is builtin and cannot be deleted`)
  // Boot raises a StartupError for a missing defaultRole; deleting into that state would
  // leave every first contact throwing until someone restarts and sees why.
  if (defaultRole !== undefined && name === defaultRole) {
    throw new Error(`role '${name}' is the configured default role and cannot be deleted`)
  }
  db.delete(role).where(eq(role.id, found.id)).run()
}

// The published contract says enable() rejects; enablePlugin() returns a refusal object,
// so the reason has to be re-thrown or a caller would read `undefined` as success.
async function enableOrThrow(db: Db, sporesDir: string, name: string): Promise<void> {
  const result = await enablePlugin(db, sporesDir, name)
  if (!result.ok) throw new Error(result.reason)
}

// loadSporeModule() propagates whatever the spore throws at import; formSchema() resolves
// a FormSchema, so every fault becomes its available: false branch rather than a rejection.
async function formSchemaOf(db: Db, sporesDir: string, name: string): Promise<FormSchema> {
  if (getInstall(db, name) === null) {
    return { available: false, reason: `plugin '${name}' is not installed` }
  }
  let module: Awaited<ReturnType<typeof loadSporeModule>>
  try {
    module = await loadSporeModule(sporesDir, name)
  } catch (e) {
    return { available: false, reason: `spore '${name}' failed to load: ${describeThrown(e)}` }
  }
  if (module === undefined) {
    return { available: false, reason: `no spore named '${name}' is present on disk` }
  }
  return formSchemaFor(module?.configSchema)
}

// The reason plugins.configure is safe to grant: a scope that lists configuration must
// not become a way to read every credential in the substrate.
function redactSecrets(db: Db, name: string): Record<string, unknown> {
  // Its three siblings on this interface reject for an unknown plugin; resolving {} here
  // read exactly like a real plugin holding no settings.
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  const rows = db.select().from(pluginSetting).where(eq(pluginSetting.pluginName, name)).all()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const parsed: unknown = row.isSecret ? '••••' : JSON.parse(row.value)
    out[row.key] = parsed
  }
  return out
}

/**
 * Refuses a key the plugin's own JSON Schema does not declare. An undeclared key would
 * otherwise be dropped in silence by a loose schema, or block enable() by a strict one.
 * A plugin publishing no schema is unguarded.
 */
async function writeDeclaredSetting(
  db: Db, sporesDir: string, name: string, key: string, value: unknown,
): Promise<void> {
  const form = await formSchemaOf(db, sporesDir, name)
  if (form.available) {
    const schema = form.schema as { properties?: unknown, additionalProperties?: unknown }
    const properties: unknown = schema.properties
    // z.object emits no additionalProperties, z.looseObject emits `{}` and z.strictObject
    // `false`. Only an explicitly open schema is exempt: refusing every key a deliberately
    // open plugin accepts would shut it out of the one configuration surface there is.
    const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false
    // hasOwn, never `in`: the schema is a plugin-supplied plain object, and 'constructor'
    // is a key an operator can type.
    if (!open && typeof properties === 'object' && properties !== null && !Object.hasOwn(properties, key)) {
      throw new Error(`plugin '${name}' declares no setting '${key}'`)
    }
  }
  rewriteSetting(db, name, key, value)
}

// Carries the row's is_secret forward: writeSetting() rewrites that column too, so a
// secret updated through this scope would come back unredacted from settings().
// A key with no row yet is not secret — nothing in this phase can declare one.
function rewriteSetting(db: Db, name: string, key: string, value: unknown): void {
  const existing = db
    .select({ isSecret: pluginSetting.isSecret })
    .from(pluginSetting)
    .where(and(eq(pluginSetting.pluginName, name), eq(pluginSetting.key, key)))
    .get()
  writeSetting(db, name, key, value, existing?.isSecret ?? false)
}

// Defers the call into .then() so a throwing driver rejects the returned promise
// instead of throwing synchronously out of what the published contract says is async.
function toPromise<T>(fn: () => T): Promise<T> {
  return Promise.resolve().then(fn)
}

/**
 * Mounts one key per granted scope onto a fresh object — never the full API with keys
 * deleted — so a plugin without a scope has no property to find, not a rejected call.
 */
export function createMyceliumApi(
  registry: Registry,
  scopes: readonly MyceliumScope[],
  send: (target: PushTarget, content: OutgoingContent) => Promise<void>,
  db: Db,
  sporesDir: string,
  defaultRole?: string,
): object {
  const granted = new Set(scopes)
  // No prototype: a global Object.prototype pollution must not forge an absent scope
  // as present through `in`, which is exactly how a caller is expected to check.
  const api = Object.create(null) as Partial<
    PluginsRead & HealthRead & MessagesSend & PrincipalsRead & PrincipalsManage &
    RolesRead & RolesAssign & RolesManage & PluginsToggle & PluginsConfigure
  >

  if (granted.has('plugins.read')) api.listPlugins = () => listPlugins(registry, sporesDir, db)
  if (granted.has('health.read')) api.health = () => aggregateHealth(registry)
  if (granted.has('messages.send')) api.send = send

  if (granted.has('principals.read')) {
    api.listPrincipals = () => toPromise(() => listPrincipals(db))
    api.getPrincipal = (id) => toPromise(() => loadPrincipal(db, id))
    api.findByIdentity = (channel, externalId) => toPromise(() => findByIdentity(db, channel, externalId))
  }
  if (granted.has('principals.manage')) {
    api.markReviewed = (id) => toPromise(() => markReviewed(db, id))
    api.setDisplayName = (id, name) => toPromise(() => setDisplayName(db, id, name))
  }
  if (granted.has('roles.read')) {
    api.listRoles = () => toPromise(() => listRoles(db))
    api.rolesOf = (id) => toPromise(() => rolesOf(db, id))
  }
  if (granted.has('roles.assign')) {
    api.assignRole = (p, r) => toPromise(() => assignRole(db, p, r))
    api.revokeRole = (p, r) => toPromise(() => revokeRole(db, p, r))
  }
  if (granted.has('roles.manage')) {
    api.createRole = (name, patterns) => toPromise(() => createRole(db, name, patterns))
    api.setRoleCommands = (name, patterns) => toPromise(() => setRoleCommands(db, name, patterns))
    api.deleteRole = (name) => toPromise(() => deleteRole(db, name, defaultRole))
  }
  if (granted.has('plugins.toggle')) {
    api.enable = (name) => enableOrThrow(db, sporesDir, name)
    api.disable = (name) => toPromise(() => { setEnabled(db, name, false) })
  }
  if (granted.has('plugins.configure')) {
    api.settings = (name) => toPromise(() => redactSecrets(db, name))
    api.setSetting = (name, key, value) => writeDeclaredSetting(db, sporesDir, name, key, value)
    api.formSchema = (name) => formSchemaOf(db, sporesDir, name)
  }

  return api
}
