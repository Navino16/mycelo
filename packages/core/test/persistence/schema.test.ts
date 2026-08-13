import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { pluginInstall, pluginSetting } from '../../src/persistence/schema.js'

it('a plugin install carries settings that cascade on delete', () => {
  const { db, close } = openDatabase(':memory:')
  migrateDatabase(db)
  db.insert(pluginInstall).values({
    name: 'radarr', kind: 'rhiza', enabled: false, installedAt: new Date(),
  }).run()
  db.insert(pluginSetting).values({
    pluginName: 'radarr', key: 'url', value: 'http://x', isSecret: false,
  }).run()

  db.delete(pluginInstall).where(eq(pluginInstall.name, 'radarr')).run()
  expect(db.select().from(pluginSetting).all()).toHaveLength(0)
  close()
})
