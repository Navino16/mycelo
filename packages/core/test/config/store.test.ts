import { expect, it } from 'bun:test'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import {
  listInstalls, readAllSettings, readSettings, recordInstall, setEnabled, writeSetting,
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

it('recording an install twice does not reset its enabled flag', () => {
  const { db, close } = fresh()
  recordInstall(db, 'radarr', 'rhiza')
  setEnabled(db, 'radarr', true)
  recordInstall(db, 'radarr', 'rhiza')
  // An upsert here would silently disable a plugin the operator had turned on.
  expect(listInstalls(db)[0]?.enabled).toBe(true)
  close()
})
