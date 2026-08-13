import { expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import {
  clearSetting, getInstall, listInstalls, readAllSettings, readSettings, recordInstall,
  removeInstall, setEnabled, writeSetting,
} from '../../src/config/store.js'

function fresh() {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

it('a setting round-trips with its type intact', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  writeSetting(db, 'radarr', 'port', 8080, false)
  writeSetting(db, 'radarr', 'url', 'http://x', false)
  // 8080, not "8080": a Zod z.number() would reject the string and name no cause.
  expect(readSettings(db, 'radarr')).toEqual({ port: 8080, url: 'http://x' })
  close()
})

it('writing the same key twice replaces rather than duplicating', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  writeSetting(db, 'radarr', 'url', 'http://a', false)
  writeSetting(db, 'radarr', 'url', 'http://b', false)
  expect(readSettings(db, 'radarr')).toEqual({ url: 'http://b' })
  close()
})

it('readAllSettings keys by plugin and includes an install with no settings', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  recordInstall(db, 'ping', 'enzyme')
  writeSetting(db, 'radarr', 'url', 'http://x', false)
  expect(readAllSettings(db)).toEqual({ radarr: { url: 'http://x' }, ping: {} })
  close()
})

// A raw sql query with no `fields` answers a positional array, never a keyed object.
function totalChanges(db: Db): number {
  return db.get<[number]>(sql`SELECT total_changes()`)?.[0] ?? 0
}

it('records an install already enabled, in one write', () => {
  const { db, close } = fresh()
  const before = totalChanges(db)
  recordInstall(db, 'radarr', 'rhiza', true)
  // The first run used to record then enable: a crash between the two left a row the
  // next boot could no longer recognise as belonging to a first run. The count is the
  // claim — reading the column back cannot tell one write from two.
  expect(totalChanges(db) - before).toBe(1)
  expect(getInstall(db, 'radarr')?.enabled).toBe(true)
  close()
})

it('recording an install twice does not reset its enabled flag', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  setEnabled(db, 'radarr', true)
  recordInstall(db, 'radarr', 'rhiza')
  // An upsert here would silently disable a plugin the operator had turned on.
  expect(listInstalls(db)[0]?.enabled).toBe(true)
  close()
})

it('getInstall returns null for a plugin that was never installed', () => {
  const { db, close } = fresh()
  expect(getInstall(db, 'ghost')).toBeNull()
  close()
})

it('removeInstall takes its settings with it', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  writeSetting(db, 'radarr', 'url', 'http://x', false)
  removeInstall(db, 'radarr')
  expect(getInstall(db, 'radarr')).toBeNull()
  expect(readSettings(db, 'radarr')).toEqual({})
  close()
})

it('clearSetting removes only the named key, not every setting on the plugin', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  writeSetting(db, 'radarr', 'url', 'http://x', false)
  writeSetting(db, 'radarr', 'port', 8080, false)
  clearSetting(db, 'radarr', 'url')
  expect(readSettings(db, 'radarr')).toEqual({ port: 8080 })
  close()
})

it('setEnabled throws for a plugin that is not installed', () => {
  const { db, close } = fresh()
  expect(() => setEnabled(db, 'ghost', true)).toThrow("plugin 'ghost' is not installed")
  close()
})

it('writeSetting throws for a plugin that is not installed', () => {
  const { db, close } = fresh()
  expect(() => writeSetting(db, 'ghost', 'url', 'x', false)).toThrow("plugin 'ghost' is not installed")
  close()
})
