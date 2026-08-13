import { and, eq } from 'drizzle-orm'
import type { Db } from '../persistence/db.js'
import { pluginInstall, pluginSetting } from '../persistence/schema.js'

export interface InstalledPlugin {
  name: string
  kind: string
  enabled: boolean
  installedAt: Date
}

export function listInstalls(db: Db): readonly InstalledPlugin[] {
  return db.select().from(pluginInstall).all()
}

export function getInstall(db: Db, name: string): InstalledPlugin | null {
  return db.select().from(pluginInstall).where(eq(pluginInstall.name, name)).get() ?? null
}

// onConflictDoNothing, never an upsert: re-recording an install must not silently
// disable a plugin the operator already enabled.
export function recordInstall(db: Db, name: string, kind: string, enabled = false): void {
  db.insert(pluginInstall)
    .values({ name, kind, enabled, installedAt: new Date() })
    .onConflictDoNothing()
    .run()
}

export function removeInstall(db: Db, name: string): void {
  db.delete(pluginInstall).where(eq(pluginInstall.name, name)).run()
}

export function setEnabled(db: Db, name: string, enabled: boolean): void {
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  db.update(pluginInstall).set({ enabled }).where(eq(pluginInstall.name, name)).run()
}

// Values are JSON text: a Zod z.number() must receive a number, and '8080' would fail
// with a diagnostic that points at the schema rather than at the storage.
export function readSettings(db: Db, name: string): Record<string, unknown> {
  const rows = db.select().from(pluginSetting).where(eq(pluginSetting.pluginName, name)).all()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const parsed: unknown = JSON.parse(row.value)
    out[row.key] = parsed
  }
  return out
}

export function writeSetting(db: Db, name: string, key: string, value: unknown, isSecret: boolean): void {
  if (getInstall(db, name) === null) throw new Error(`plugin '${name}' is not installed`)
  db.insert(pluginSetting)
    .values({ pluginName: name, key, value: JSON.stringify(value), isSecret })
    .onConflictDoUpdate({
      target: [pluginSetting.pluginName, pluginSetting.key],
      set: { value: JSON.stringify(value), isSecret },
    })
    .run()
}

export function clearSetting(db: Db, name: string, key: string): void {
  db.delete(pluginSetting)
    .where(and(eq(pluginSetting.pluginName, name), eq(pluginSetting.key, key)))
    .run()
}

/** Every install's settings, keyed by plugin name — the shape germinate() takes. */
export function readAllSettings(db: Db): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const install of listInstalls(db)) out[install.name] = readSettings(db, install.name)
  return out
}
