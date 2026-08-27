import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import type {
  CommandsRead, ConversationsRead, HealthRead, IncomingMessage, LocaleManage, MessagesBroadcast, PluginsConfigure,
  PluginsRead, PluginsToggle, PrincipalsManage, PrincipalsRead, PushTarget, RestrictionsManage,
  RolesAssign, RolesManage, RolesRead, SourcesManage,
} from '@mycelo/septum'
import { assignRole, createRole } from '../src/authorization/roles.js'
import { addBroadcastTarget, recordConversation } from '../src/conversations/registry.js'
import { getInstall, recordInstall, setEnabled, writeSetting } from '../src/config/store.js'
import { bootstrapIdentity } from '../src/identity/bootstrap.js'
import { resolvePrincipal } from '../src/identity/resolve.js'
import type { Registry } from '../src/germination/registry.js'
import { MYCELIUM_SCOPES } from '@mycelo/septum'
import type { MyceliumScope } from '@mycelo/septum'
import { MOUNTABLE_SCOPES, resolve } from '../src/germination/anastomoses.js'
import { resolveLocale } from '../src/i18n/locale.js'
import { createMyceliumApi } from '../src/mycelium-rhiza.js'
import type { MyceliumApiOptions } from '../src/mycelium-rhiza.js'
import { addSource, seedOfficialSource } from '../src/sporangium/sources.js'
import { migrateDatabase, openDatabase } from '../src/persistence/db.js'
import type { Db } from '../src/persistence/db.js'
import { principal } from '../src/persistence/schema.js'
import { bundleOf } from './support/bundle.js'
import { silentLogger as stubLogger } from './support/logger.js'
import { rejectsWith } from './support/rejects.js'
import { emptyRegistry } from './support/registry.js'

const stubTranslator = { translate: (_d: string, key: string) => key, availableLocales: () => ['en', 'fr'] }

function seedPrincipal(db: Db, id: string): void {
  db.insert(principal).values({ id, createdAt: new Date() }).run()
}

const stubSend = async () => {}
const noSend = stubSend
const SPORES = [resolvePath(import.meta.dirname, '../../../fixtures')]

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

const registry = {
  hyphae: [], rhizas: [], inhibitors: [], dormant: [{ name: 'broken', reason: 'create() returned no api' }],
  enzymes: [{ name: 'media', manifest: { kind: 'enzyme', name: 'media', septum: '^0.10',
    commands: [{ name: 'movies', description: 'x', code: 'h' }] }, instance: null }],
  routes: new Map(),
} as unknown as Registry

it('mounts only what the scopes grant', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh(), SPORES)
  expect(typeof (api as PluginsRead).listPlugins).toBe('function')
  expect('send' in api).toBe(false)
  expect('health' in api).toBe(false)
})

it('does not mount listPlugins when plugins.read is not granted', () => {
  expect('listPlugins' in createMyceliumApi(registry, ['health.read'], stubSend, fresh(), SPORES)).toBe(false)
})

it('lists germinated and dormant plugins with their reasons', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh(), SPORES) as PluginsRead
  expect(api.listPlugins()).toEqual([
    { name: 'media', kind: 'enzyme', commands: ['movies'], state: 'germinated', enabled: true },
    { name: 'broken', commands: [], state: 'dormant', reason: 'create() returned no api', enabled: true },
  ])
})

it('omits kind for a dormant plugin rather than inventing one, since none was ever known', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, fresh(), SPORES) as PluginsRead
  const broken = api.listPlugins().find((p) => p.name === 'broken')
  expect(broken).toBeDefined()
  expect(broken).not.toHaveProperty('kind')
})

it('lists a germinated inhibitor with an empty command list', () => {
  const withInhibitor = {
    ...registry,
    inhibitors: [{ name: 'gate', manifest: { kind: 'inhibitor', name: 'gate', septum: '^0.10', enforcing: true } }],
  } as unknown as Registry
  const api = createMyceliumApi(withInhibitor, ['plugins.read'], stubSend, fresh(), SPORES) as PluginsRead
  expect(api.listPlugins()).toContainEqual({ name: 'gate', kind: 'inhibitor', commands: [], state: 'germinated', enabled: true })
})

it('lists a disabled install that never reached the registry, distinct from dormant', () => {
  // germinate.ts skips a disabled install before resolve() runs, so it never becomes a
  // registry entry at all — 'quiet', an enzyme that would germinate cleanly if enabled,
  // proves the entry comes from the install row, not from anything the registry reports.
  const db = fresh()
  recordInstall(db, 'quiet', 'enzyme')
  setEnabled(db, 'quiet', false)
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend, db, SPORES) as PluginsRead
  expect(api.listPlugins()).toContainEqual({ name: 'quiet', kind: 'enzyme', commands: [], state: 'disabled', enabled: false })
  const quiet = api.listPlugins().find((p) => p.name === 'quiet')
  expect(quiet?.state).not.toBe('dormant')
})

it('aggregates each germinated rhiza health', async () => {
  const checkedAt = new Date(0)
  const withRhiza = { ...registry, rhizas: [{ name: 'mock', manifest: {},
    instance: { health: async () => ({ state: 'healthy', checkedAt }) } }] } as unknown as Registry
  const api = createMyceliumApi(withRhiza, ['health.read'], stubSend, fresh(), SPORES) as HealthRead
  expect(await api.health()).toEqual([{ rhiza: 'mock', status: { state: 'healthy', checkedAt } }])
})

describe('createMyceliumApi, the phase 4 scopes', () => {
  it('mounts no principal or role method when no scope grants it', () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, fresh(), SPORES)
    for (const method of [
      'listPrincipals', 'getPrincipal', 'findByIdentity', 'markReviewed', 'setDisplayName',
      'listRoles', 'rolesOf', 'assignRole', 'revokeRole', 'createRole', 'setRoleCommands', 'deleteRole',
    ]) {
      expect(method in api).toBe(false)
    }
  })

  it('mounts principals.read alone without principals.manage', () => {
    const api = createMyceliumApi(emptyRegistry(), ['principals.read'], noSend, fresh(), SPORES)
    expect('listPrincipals' in api).toBe(true)
    expect('markReviewed' in api).toBe(false)
  })

  it('finds a principal by its channel identity', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'alice', displayName: 'alice' })
    const api = createMyceliumApi(emptyRegistry(), ['principals.read'], noSend, db, SPORES) as PrincipalsRead
    expect((await api.findByIdentity('console', 'alice'))?.id).toBe(p.id)
    expect(await api.findByIdentity('console', 'nobody')).toBeNull()
  })

  it('assigns and revokes a role by name', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db, SPORES) as RolesAssign
    const read = createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db, SPORES) as RolesRead
    await manage.createRole('guest', ['media.*'])
    await assign.assignRole(p.id, 'guest')
    expect(await read.rolesOf(p.id)).toEqual(['guest'])
    await assign.revokeRole(p.id, 'guest')
    expect(await read.rolesOf(p.id)).toEqual([])
  })

  it('rejects assigning a role that does not exist', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db, SPORES) as RolesAssign
    await rejectsWith(assign.assignRole(p.id, 'ghost'), /ghost/)
  })

  it('refuses to delete or rewrite a builtin role', async () => {
    const db = fresh()
    bootstrapIdentity(db, { owner: { channel: 'console', userId: 'alice' } })
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    await rejectsWith(manage.deleteRole('owner'), /builtin/)
    await rejectsWith(manage.setRoleCommands('owner', ['media.*']), /builtin/)
  })

  it('rejects deleting a role that does not exist, naming it', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    await rejectsWith(manage.deleteRole('typo'), /typo/)
  })

  it('refuses to delete the configured default role', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES, { defaultRole: 'newcomer' }) as RolesManage
    await manage.createRole('newcomer', [])
    // Boot refuses this state with a StartupError; deleting into it at runtime must not
    // leave first contact throwing on every new sender.
    await rejectsWith(manage.deleteRole('newcomer'), /default role/)
  })

  it('rejects rewriting a role that does not exist, naming it', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    await rejectsWith(manage.setRoleCommands('typo', ['media.*']), /typo/)
  })

  it('replaces a role\'s patterns wholesale rather than appending', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    const read = createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db, SPORES) as RolesRead
    await manage.createRole('guest', ['media.*', 'admin.plugins'])
    await manage.setRoleCommands('guest', ['media.movies'])
    expect((await read.listRoles()).find((r) => r.name === 'guest')?.patterns).toEqual(['media.movies'])
  })

  it('does not let Object.prototype pollution forge an ungranted scope', () => {
    // A caller probes for a scope with `in`, so a polluted prototype must not answer for it.
    Object.defineProperty(Object.prototype, 'assignRole', { value: () => {}, configurable: true, enumerable: false })
    try {
      const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, fresh(), SPORES)
      expect('assignRole' in api).toBe(false)
    } finally {
      Reflect.deleteProperty(Object.prototype, 'assignRole')
    }
  })

  it('marks a principal reviewed and renames it', async () => {
    const db = fresh()
    const p = resolvePrincipal(db, { channel: 'console', externalId: 'carol' })
    const api = createMyceliumApi(emptyRegistry(), ['principals.manage', 'principals.read'], noSend, db, SPORES) as
      PrincipalsManage & PrincipalsRead
    await api.markReviewed(p.id)
    await api.setDisplayName(p.id, 'Carol')
    expect((await api.getPrincipal(p.id))?.displayName).toBe('Carol')
    expect(db.select().from(principal).get()?.reviewedAt).toBeInstanceOf(Date)
  })
})

// The worst defect of phase 4 was a scope mounted in one place and gated in the other, and
// it was found by a fixture rather than a test. Phase 5 mounts the last two.
describe('MOUNTABLE_SCOPES against what createMyceliumApi actually mounts', () => {
  it('mounts exactly the scopes MOUNTABLE_SCOPES declares, and declares every scope septum has', () => {
    const mounted = MYCELIUM_SCOPES.filter((scope) => {
      const api = createMyceliumApi(emptyRegistry(), [scope], noSend, fresh(), SPORES, { translator: stubTranslator })
      return Object.keys(api).length > 0
    })
    expect(new Set(mounted)).toEqual(new Set(MOUNTABLE_SCOPES))
    const mountable = new Set<MyceliumScope>(MOUNTABLE_SCOPES)
    expect(MYCELIUM_SCOPES.filter((s) => !mountable.has(s))).toEqual([])
  })

  it('grants every mountable scope without leaving the spore dormant', () => {
    for (const scope of MOUNTABLE_SCOPES) {
      const r = resolve([{
        location: { directory: 'user', manifestPath: 'user/spore.yaml' },
        manifest: {
          kind: 'enzyme', name: 'user', septum: '^0.10',
          commands: [{ name: 'user', description: 'x', respond: 'hi' }],
          requires: [{ rhiza: 'mycelium', scopes: [scope] }],
        },
      }] as unknown as Parameters<typeof resolve>[0])
      expect(r.dormant).toEqual([])
      expect(r.order[0]?.scopes).toEqual([scope])
    }
  })
})

describe('createMyceliumApi, locale.manage', () => {
  it('mounts nothing for a spore without the scope', () => {
    const api = createMyceliumApi(emptyRegistry(), [], noSend, fresh(), SPORES, { translator: stubTranslator })
    expect('setPrincipalLocale' in api).toBe(false)
    expect('availableLocales' in api).toBe(false)
  })

  it('throws rather than mounting a scope with no translator to answer from', () => {
    expect(() => createMyceliumApi(emptyRegistry(), ['locale.manage'], noSend, fresh(), SPORES))
      .toThrow(/locale.manage/)
  })

  it('answers every locale a catalogue provides', () => {
    const api = createMyceliumApi(emptyRegistry(), ['locale.manage'], noSend, fresh(), SPORES,
      { translator: stubTranslator }) as LocaleManage
    expect(api.availableLocales()).toEqual(['en', 'fr'])
  })

  it('rejects a locale no catalogue provides, naming what is available', async () => {
    const db = fresh()
    seedPrincipal(db, 'p1')
    const api = createMyceliumApi(emptyRegistry(), ['locale.manage'], noSend, db, SPORES,
      { translator: stubTranslator }) as LocaleManage
    expect(api.setPrincipalLocale('p1', 'de')).rejects.toThrow(/available: en, fr/)
  })

  it('writes a canonical tag through', async () => {
    const db = fresh()
    seedPrincipal(db, 'p1')
    const api = createMyceliumApi(emptyRegistry(), ['locale.manage'], noSend, db, SPORES,
      { translator: { translate: (_d, key) => key, availableLocales: () => ['fr-FR'] } }) as LocaleManage
    await api.setPrincipalLocale('p1', 'fr-fr')
    expect(resolveLocale(db, 'console', 'nowhere', 'p1', 'en')).toBe('fr-FR')
  })
})

// Curated diagnostics, not raw SQLite: /role-new answered "command 'role-new' failed" for
// a duplicate name or a repeated pattern, and the three silent resolves named nothing.
describe('rejections a caller can act on', () => {
  it('rejects creating a role whose name is taken, or empty', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    await manage.createRole('guest', ['media.*'])
    await rejectsWith(manage.createRole('guest', ['admin.*']), /'guest' already exists/)
    await rejectsWith(manage.createRole('', []), /cannot be empty/)
    expect(await (createMyceliumApi(emptyRegistry(), ['roles.read'], noSend, db, SPORES) as RolesRead).listRoles())
      .toHaveLength(1)
  })

  it('rejects a pattern listed twice in one call, on create and on rewrite', async () => {
    const db = fresh()
    const manage = createMyceliumApi(emptyRegistry(), ['roles.manage'], noSend, db, SPORES) as RolesManage
    await rejectsWith(manage.createRole('guest', ['media.*', 'media.*']), /'media.\*' is listed twice/)
    await manage.createRole('guest', ['media.*'])
    await rejectsWith(manage.setRoleCommands('guest', ['admin.*', 'admin.*']), /listed twice/)
  })

  it('rejects markReviewed, setDisplayName, assignRole and revokeRole for an unknown principal', async () => {
    const db = fresh()
    bootstrapIdentity(db, { owner: { channel: 'console', userId: 'alice' } })
    const manage = createMyceliumApi(emptyRegistry(), ['principals.manage'], noSend, db, SPORES) as PrincipalsManage
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db, SPORES) as RolesAssign
    await rejectsWith(manage.markReviewed('nobody'), /principal 'nobody' does not exist/)
    await rejectsWith(manage.setDisplayName('nobody', 'X'), /principal 'nobody' does not exist/)
    await rejectsWith(assign.assignRole('nobody', 'owner'), /principal 'nobody' does not exist/)
    await rejectsWith(assign.revokeRole('nobody', 'owner'), /principal 'nobody' does not exist/)
  })

  it('still reports an unknown role before an unknown principal, so the first fault named is the caller\'s', async () => {
    const db = fresh()
    const assign = createMyceliumApi(emptyRegistry(), ['roles.assign'], noSend, db, SPORES) as RolesAssign
    await rejectsWith(assign.assignRole('nobody', 'ghost'), /role 'ghost'/)
  })
})

describe('createMyceliumApi, the phase 5 scopes', () => {
  it('mounts no toggle or configure method when no scope grants it', () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, fresh(), SPORES)
    // Absent, not rejecting: the phase 3 contract is that an ungranted scope leaves no key.
    for (const method of ['enable', 'disable', 'settings', 'setSetting', 'formSchema']) {
      expect(method in api).toBe(false)
    }
  })

  it('mounts plugins.toggle alone without plugins.configure', () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.toggle'], noSend, fresh(), SPORES)
    expect('enable' in api).toBe(true)
    expect('settings' in api).toBe(false)
  })

  it('redacts a secret rather than returning it', async () => {
    const db = fresh()
    recordInstall(db, 'radarr', 'rhiza')
    writeSetting(db, 'radarr', 'url', 'http://x', false)
    writeSetting(db, 'radarr', 'apiKey', 'sk-real-secret', true)
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    const settings = await api.settings('radarr')
    expect(settings['url']).toBe('http://x')
    expect(settings['apiKey']).not.toBe('sk-real-secret')
    expect(settings['apiKey']).toBe('••••')
  })

  it('writes a setting through setSetting, leaving it readable', async () => {
    const db = fresh()
    recordInstall(db, 'radarr', 'rhiza')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    await api.setSetting('radarr', 'url', 'http://y')
    expect((await api.settings('radarr'))['url']).toBe('http://y')
  })

  // writeSetting() rewrites is_secret too, so the naive call would un-redact a credential
  // the moment an operator updated it through this very scope.
  it('keeps a setting secret when setSetting rewrites it', async () => {
    const db = fresh()
    recordInstall(db, 'radarr', 'rhiza')
    writeSetting(db, 'radarr', 'apiKey', 'sk-old', true)
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    await api.setSetting('radarr', 'apiKey', 'sk-new')
    expect((await api.settings('radarr'))['apiKey']).toBe('••••')
  })

  it('rejects setSetting for a plugin that is not installed', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, fresh(), SPORES) as PluginsConfigure
    await rejectsWith(api.setSetting('ghost', 'url', 'x'), /'ghost' is not installed/)
  })

  it('reports formSchema unavailable for a plugin that is not installed', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, fresh(), SPORES) as PluginsConfigure
    expect(await api.formSchema('ghost')).toEqual({ available: false, reason: "plugin 'ghost' is not installed" })
  })

  it('reports formSchema unavailable for an install whose spore is gone from disk', async () => {
    const db = fresh()
    recordInstall(db, 'vanished', 'rhiza')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    expect(await api.formSchema('vanished'))
      .toEqual({ available: false, reason: "no spore named 'vanished' is present on disk" })
  })

  // loadSporeModule propagates whatever the spore throws at import; formSchema() has an
  // available: false branch and must use it, since the contract says it resolves a
  // FormSchema. A spore absent from disk does NOT reach that catch — discover() answers []
  // for a missing directory rather than throwing — so only a real import throw pins it.
  it('answers formSchema with the import failure rather than rejecting', async () => {
    const db = fresh()
    const dir = mkdtempSync(join(tmpdir(), 'mycelo-formschema-'))
    try {
      mkdirSync(join(dir, 'boomspore', 'src'), { recursive: true })
      writeFileSync(
        join(dir, 'boomspore', 'spore.yaml'),
        'kind: enzyme\nname: boomspore\nseptum: "^0.10"\n'
          + 'commands:\n  - name: boom\n    description: x\n    code: handleBoom\n',
        'utf8',
      )
      writeFileSync(join(dir, 'boomspore', 'src/index.ts'), 'throw new Error("import explodes")\n', 'utf8')
      recordInstall(db, 'boomspore', 'enzyme')
      const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, [dir]) as PluginsConfigure
      const schema = await api.formSchema('boomspore')
      expect(schema.available).toBe(false)
      // The real cause, not merely "unavailable": an operator cannot act on the latter.
      if (!schema.available) expect(schema.reason).toContain('import explodes')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('answers formSchema for a spore whose configSchema emits no JSON Schema', async () => {
    const db = fresh()
    recordInstall(db, 'gate', 'inhibitor')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    expect(await api.formSchema('gate'))
      .toEqual({ available: false, reason: 'this plugin publishes no JSON Schema: configure it by hand' })
  })

  it('enables a plugin on disk and disables it again', async () => {
    const db = fresh()
    recordInstall(db, 'ping', 'enzyme')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.toggle'], noSend, db, SPORES) as PluginsToggle
    await api.enable('ping')
    expect(getInstall(db, 'ping')?.enabled).toBe(true)
    await api.disable('ping')
    expect(getInstall(db, 'ping')?.enabled).toBe(false)
  })

  // enablePlugin() returns a refusal object; the published contract says enable() rejects,
  // so a caller reading `undefined` as success is the defect this pins.
  it('rejects enable with the refusal reason rather than resolving', async () => {
    const db = fresh()
    recordInstall(db, 'gate', 'inhibitor')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.toggle'], noSend, db, SPORES) as PluginsToggle
    await rejectsWith(api.enable('ghost'), /'ghost' is not installed/)
    expect(getInstall(db, 'gate')?.enabled).toBe(false)
  })

  it('rejects disable for a plugin that is not installed', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.toggle'], noSend, fresh(), SPORES) as PluginsToggle
    await rejectsWith(api.disable('ghost'), /'ghost' is not installed/)
  })

  // setSetting, formSchema and enable all reject for an uninstalled plugin; settings()
  // answered {}, which a caller cannot tell from a real plugin holding no settings.
  it('rejects settings for a plugin that is not installed', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, fresh(), SPORES) as PluginsConfigure
    await rejectsWith(api.settings('ghost'), /'ghost' is not installed/)
  })
})

// A misspelled key was written, confirmed, and then shown back by /plugin-config while the
// plugin went on using its default — fail-open on a spore whose whole purpose is a rule.
describe('setSetting against the keys the plugin declares', () => {
  // The emitted JSON is computed here with the workspace's own Zod and inlined, rather than
  // hand-written: what the guard reads is whatever z.toJSONSchema actually produces, and a
  // temp spore cannot resolve zod from a tmpdir.
  function declaring(jsonSchema: object): string {
    const dir = mkdtempSync(join(tmpdir(), 'mycelo-declared-'))
    mkdirSync(join(dir, 'declares', 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'declares', 'spore.yaml'),
      'kind: enzyme\nname: declares\nseptum: "^0.10"\n'
        + 'commands:\n  - name: declares\n    description: x\n    code: handleIt\n',
      'utf8',
    )
    writeFileSync(
      join(dir, 'declares', 'src/index.ts'),
      'export default {\n'
        + '  configSchema: {\n'
        + '    safeParse: (input) => ({ success: true, data: input }),\n'
        + `    toJsonSchema: () => (${JSON.stringify(jsonSchema)}),\n`
        + '  },\n'
        + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
        + '}\n',
      'utf8',
    )
    return dir
  }

  async function withSpore(jsonSchema: object, body: (api: PluginsConfigure) => Promise<void>): Promise<void> {
    const db = fresh()
    const dir = declaring(jsonSchema)
    try {
      recordInstall(db, 'declares', 'enzyme')
      await body(createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, [dir]) as PluginsConfigure)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const CLOSED = z.toJSONSchema(z.object({ url: z.string() }), { io: 'input' })
  const LOOSE = z.toJSONSchema(z.looseObject({ url: z.string() }), { io: 'input' })
  const STRICT = z.toJSONSchema(z.strictObject({ url: z.string() }), { io: 'input' })

  it('rejects a key the published JSON Schema does not declare, and accepts one it does', async () => {
    await withSpore(CLOSED, async (api) => {
      await rejectsWith(api.setSetting('declares', 'ur1', 'http://x'), /'declares' declares no setting 'ur1'/)
      expect(await api.settings('declares')).toEqual({})
      await api.setSetting('declares', 'url', 'http://x')
      expect(await api.settings('declares')).toEqual({ url: 'http://x' })
    })
  })

  // z.object emits no additionalProperties at all, z.looseObject emits `{}`. Refusing an
  // undeclared key there would shut a deliberately open plugin out of the only
  // configuration surface this phase provides, with no channel workaround.
  it('writes any key when the schema declares itself open', async () => {
    expect(LOOSE).toHaveProperty('additionalProperties')
    expect(CLOSED).not.toHaveProperty('additionalProperties')
    await withSpore(LOOSE, async (api) => {
      await api.setSetting('declares', 'anything', 'x')
      expect(await api.settings('declares')).toEqual({ anything: 'x' })
    })
  })

  it('still refuses an undeclared key when the schema closes itself explicitly', async () => {
    // z.strictObject emits additionalProperties: false, which says the opposite of `{}`.
    expect(STRICT).toHaveProperty('additionalProperties', false)
    await withSpore(STRICT, async (api) => {
      await rejectsWith(api.setSetting('declares', 'ur1', 'x'), /declares no setting 'ur1'/)
    })
  })

  it('still writes any key for a plugin that publishes no JSON Schema', async () => {
    const db = fresh()
    recordInstall(db, 'gate', 'inhibitor')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.configure'], noSend, db, SPORES) as PluginsConfigure
    // gate builds its ConfigSchema by hand and emits no schema, so nothing here knows
    // which keys exist. The ledger records that half; it is not closed by this guard.
    await api.setSetting('gate', 'group_id', 'flatmates')
    expect(await api.settings('gate')).toEqual({ group_id: 'flatmates' })
  })
})

// syncInstalls keeps the row of a spore whose directory has gone, so an operator's
// settings survive an unmounted volume — and then nothing could report that it exists.
describe('an install with no spore on disk', () => {
  it('is reported dormant when it is enabled, rather than vanishing from the listing', () => {
    const db = fresh()
    recordInstall(db, 'vanished', 'rhiza')
    setEnabled(db, 'vanished', true)
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, db, SPORES) as PluginsRead
    expect(api.listPlugins()).toContainEqual({
      name: 'vanished', kind: 'rhiza', commands: [],
      state: 'dormant', reason: "no spore named 'vanished' is present on disk", enabled: true,
    })
  })

  it('is still reported disabled when it is disabled', () => {
    const db = fresh()
    recordInstall(db, 'vanished', 'rhiza')
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, db, SPORES) as PluginsRead
    expect(api.listPlugins()).toContainEqual({
      name: 'vanished', kind: 'rhiza', commands: [], state: 'disabled', enabled: false,
    })
  })

  // The other half of the same line, deferred to phase 6: a plugin enabled since startup
  // is on disk and will germinate at the next restart, so it is staleness, not a hole.
  it('stays absent while the spore is on disk but has not germinated yet', () => {
    const db = fresh()
    recordInstall(db, 'ping', 'enzyme')
    setEnabled(db, 'ping', true)
    const api = createMyceliumApi(emptyRegistry(), ['plugins.read'], noSend, db, SPORES) as PluginsRead
    expect(api.listPlugins().map((p) => p.name)).not.toContain('ping')
  })
})

describe('conversations.read and messages.broadcast', () => {
  const seen = (channel: string, conversationId: string): IncomingMessage => ({
    channel, conversationId, messageId: 'm1',
    sender: { channel, externalId: 'alice', displayName: 'Alice' },
    text: '/ping', attachments: [], raw: null, receivedAt: new Date(0),
  })

  it('mounts listConversations only under conversations.read', async () => {
    const db = fresh()
    recordConversation(db, seen('console', 'c1'))
    const granted = createMyceliumApi(emptyRegistry(), ['conversations.read'], noSend, db, SPORES) as Partial<ConversationsRead>
    const denied = createMyceliumApi(emptyRegistry(), [], noSend, db, SPORES)
    expect((await granted.listConversations?.())?.map((c) => c.conversationId)).toEqual(['c1'])
    expect('listConversations' in denied).toBe(false)
  })

  it('reports one result per target and does not let a dead target cancel the others', async () => {
    const db = fresh()
    addBroadcastTarget(db, { channel: 'console', conversationId: 'alive' })
    addBroadcastTarget(db, { channel: 'console', conversationId: 'dead' })
    const send = (target: PushTarget): Promise<void> =>
      target.conversationId === 'dead' ? Promise.reject(new Error('gone')) : Promise.resolve()
    const api = createMyceliumApi(emptyRegistry(), ['messages.broadcast'], send, db, SPORES) as Partial<MessagesBroadcast>
    expect(await api.broadcast?.({ text: 'hello' })).toEqual([
      { target: { channel: 'console', conversationId: 'alive' }, ok: true },
      { target: { channel: 'console', conversationId: 'dead' }, ok: false, error: 'gone' },
    ])
  })

  it('resolves an empty list when no target is configured', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['messages.broadcast'], noSend, fresh(), SPORES) as Partial<MessagesBroadcast>
    expect(await api.broadcast?.({ text: 'hello' })).toEqual([])
  })

  it('mounts broadcast only under messages.broadcast', () => {
    const granted = createMyceliumApi(emptyRegistry(), ['messages.broadcast'], noSend, fresh(), SPORES) as Partial<MessagesBroadcast>
    const denied = createMyceliumApi(emptyRegistry(), [], noSend, fresh(), SPORES)
    expect(typeof granted.broadcast).toBe('function')
    expect('broadcast' in denied).toBe(false)
  })
})

describe('restrictions.manage', () => {
  it('mounts the eight methods only under the scope', () => {
    const db = fresh()
    const granted = createMyceliumApi(emptyRegistry(), ['restrictions.manage'], noSend, db, SPORES)
    const denied = createMyceliumApi(emptyRegistry(), [], noSend, db, SPORES)
    for (const method of [
      'listContextRules', 'setContextRule', 'clearContextRule', 'inhibitorChannels',
      'setInhibitorChannels', 'listBroadcastTargets', 'addBroadcastTarget', 'removeBroadcastTarget',
    ]) {
      expect(method in granted).toBe(true)
      expect(method in denied).toBe(false)
    }
  })

  it('rejects an invalid pattern with the store diagnostic rather than a generic failure', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['restrictions.manage'], noSend, fresh(), SPORES) as Partial<RestrictionsManage>
    // Bare, not awaited: `await expect(...).rejects` trips @typescript-eslint/await-thenable here.
    expect(api.setContextRule?.('nope!', 'dm')).rejects.toThrow('is not one of')
    expect(await api.listContextRules?.()).toEqual([])
  })

  it('round-trips a broadcast target through the scope', async () => {
    const api = createMyceliumApi(emptyRegistry(), ['restrictions.manage'], noSend, fresh(), SPORES) as Partial<RestrictionsManage>
    await api.addBroadcastTarget?.({ channel: 'console', conversationId: 'c1' })
    expect(await api.listBroadcastTargets?.()).toEqual([{ channel: 'console', conversationId: 'c1' }])
    await api.removeBroadcastTarget?.({ channel: 'console', conversationId: 'c1' })
    expect(await api.listBroadcastTargets?.()).toEqual([])
  })
})

describe('commands.read', () => {
  // `registry` above carries one route-less enzyme; this one carries the routes available()
  // reads, so the mount is exercised end to end rather than only checked for presence.
  function routed(): Registry {
    const routes = new Map(['plugins', 'whoami', 'movies'].map((command) => {
      const plugin = command === 'movies' ? 'media' : 'admin'
      return [command, {
        command, plugin, qualified: `${plugin}.${command}`,
        spec: { name: command, description: `cmd.${command}`, respond: 'x' },
      }]
    }))
    return { ...emptyRegistry(), routes } as unknown as Registry
  }

  it('throws rather than mounting a scope with no translator to render descriptions', () => {
    expect(() => createMyceliumApi(routed(), ['commands.read'], noSend, fresh(), SPORES))
      .toThrow(/commands.read/)
  })

  // Renders the locale into the description: stubTranslator ignores its locale argument, so
  // the mount could hardcode one and this test would still pass (review, Important 4).
  const localeAware = {
    translate: (_d: string, key: string, locale: string) => `${key}@${locale}`,
    availableLocales: () => ['en', 'fr'],
  }

  it('answers through the mount, filtered by the caller and described in the given locale', async () => {
    const db = fresh()
    createRole(db, 'admins', ['admin.*'])
    const bob = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    assignRole(db, bob.id, 'admins')
    const api = createMyceliumApi(routed(), ['commands.read'], noSend, db, SPORES,
      { translator: localeAware }) as CommandsRead

    expect(await api.available(bob, 'fr')).toEqual([
      { qualified: 'admin.plugins', name: 'plugins', plugin: 'admin', description: 'cmd.plugins@fr' },
      { qualified: 'admin.whoami', name: 'whoami', plugin: 'admin', description: 'cmd.whoami@fr' },
    ])
  })
})

describe('sources.manage', () => {
  const MANIFEST = 'kind: rhiza\nname: radarr\nseptum: "^0.10"\nrequires:\n  - rhiza: plex\n'

  function sourcesApi(db: Db, options: MyceliumApiOptions = {}): SourcesManage {
    return createMyceliumApi(emptyRegistry(), ['sources.manage'], noSend, db, SPORES, options) as SourcesManage
  }

  it('reads, adds, renames and deletes a source through the mount', async () => {
    const db = fresh()
    seedOfficialSource(db)
    const api = sourcesApi(db)
    const added = await api.addSource({ label: 'Someone else', driver: 'github', location: 'https://github.com/o/r' })
    // Two rows, not one: the official one must survive every operation on the other.
    expect((await api.listSources()).map((s) => s.label)).toEqual(['Mycelo spores', 'Someone else'])
    expect((await api.updateSource(added.id, { label: 'Renamed' }))?.label).toBe('Renamed')
    expect(await api.deleteSource(added.id)).toBe(true)
    expect((await api.listSources()).map((s) => s.label)).toEqual(['Mycelo spores'])
    // design §11: the official source is disabled, never deleted.
    const official = (await api.listSources())[0]
    expect(await api.deleteSource(official?.id ?? -1)).toBe(false)
  })

  it('rejects rather than resolving a refusal object, carrying its reason', async () => {
    const db = fresh()
    const api = sourcesApi(db, { logger: stubLogger(), managedRoot: join(tmpdir(), 'unused-managed-root') })
    await rejectsWith(api.inoculate({ sourceId: 999, name: 'radarr' }), /no source with id 999/)
  })

  it('rejects when the core mounted the scope without a logger or a managed root', async () => {
    const db = fresh()
    seedOfficialSource(db)
    await rejectsWith(sourcesApi(db).inoculate({ sourceId: 1, name: 'radarr' }), /no logger or managed root/)
  })

  it('installs through the mount and answers every warning the core owns', async () => {
    const db = fresh()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': 'export default { create: () => ({}) }' })
    const source = addSource(db, { label: 'Someone else', driver: 'github', location: 'https://github.com/o/r' })
    const managed = join(mkdtempSync(join(tmpdir(), 'mycelium-managed-')), 'spores')
    const real = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url)
      // Ordered: the release URL also ends in a tag, so the tag-list branch must not claim it.
      if (url.includes('/releases/tags/')) {
        return Promise.resolve(Response.json({ assets: [{ name: 'radarr-0.2.0.tgz', browser_download_url: 'https://cdn/x.tgz' }] }))
      }
      if (url.includes('/tags?')) return Promise.resolve(Response.json([{ name: 'radarr@0.2.0' }]))
      return Promise.resolve(new Response(tarball))
    }) as typeof fetch
    try {
      const api = sourcesApi(db, { logger: stubLogger(), managedRoot: managed })
      const outcome = await api.inoculate({ sourceId: source.id, name: 'radarr' })
      expect(outcome).toMatchObject({ name: 'radarr', strain: '0.2.0', restartRequired: true })
      // Both warnings, not the first: a third-party sporangium is not code-reviewed, and
      // nothing installed satisfies the bundle's own `requires: plex`.
      expect(outcome.warnings).toHaveLength(2)
      expect(outcome.warnings.join(' ')).toContain('not code-reviewed')
      expect(outcome.warnings.join(' ')).toContain("'plex'")
      expect(getInstall(db, 'radarr')).toMatchObject({ strain: '0.2.0', sourceId: source.id, enabled: false })
    } finally {
      globalThis.fetch = real
      rmSync(managed, { recursive: true, force: true })
    }
  })
})
