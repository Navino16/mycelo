import { describe, expect, it } from 'bun:test'
import type { Principal } from '@mycelo/septum'
import { availableCommands } from '../../src/authorization/available.js'
import { assignRole, createRole } from '../../src/authorization/roles.js'
import type { CommandRoute, Registry } from '../../src/germination/registry.js'
import { resolvePrincipal } from '../../src/identity/resolve.js'
import type { Translator } from '../../src/i18n/translator.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Db } from '../../src/persistence/db.js'

function fresh(): Db {
  const { db } = openDatabase(':memory:')
  migrateDatabase(db)
  return db
}

// Insertion order is neither alphabetical nor grouped by plugin, so an implementation that
// answers buildRoutes' discovery order rather than sorting by `qualified` fails every
// sequence assertion below (help-v1-findings.md, "Everything else the run showed").
const ROUTES: readonly (readonly [command: string, plugin: string, description: string])[] = [
  ['ping', 'ping', 'cmd.ping'],
  ['whoami', 'admin', 'cmd.whoami'],
  ['plugins', 'admin', 'cmd.plugins'],
]

// Only 'plugins' declares an arg, so the other two routes exercise the "declares none" case.
const ARGS: Record<string, readonly { name: string, description: string, required: boolean }[]> = {
  plugins: [{ name: 'verbose', description: 'arg.plugins-verbose.description', required: false }],
}

function registry(): Registry {
  const routes = new Map<string, CommandRoute>(ROUTES.map(([command, plugin, description]) => [
    command,
    {
      command,
      plugin,
      qualified: `${plugin}.${command}`,
      spec: { name: command, description, respond: 'x', args: ARGS[command] },
    } as CommandRoute,
  ]))
  return { routes } as unknown as Registry
}

// Keyed by domain as well as by locale: a translate() given any domain other than the
// command's own plugin answers the raw key, exactly as the real translator does.
const CATALOGUE: Record<string, Record<string, Record<string, string>>> = {
  admin: {
    en: { 'cmd.plugins': 'List plugins', 'cmd.whoami': 'Who am I', 'arg.plugins-verbose.description': 'Show extra detail' },
    fr: { 'cmd.plugins': 'Lister les extensions', 'cmd.whoami': 'Qui suis-je', 'arg.plugins-verbose.description': 'Afficher le détail' },
  },
  ping: {
    en: { 'cmd.ping': 'Health check' },
    fr: { 'cmd.ping': 'Vérification de santé' },
  },
}

const translator: Translator = {
  translate: (domain, key, locale) => CATALOGUE[domain]?.[locale]?.[key] ?? key,
  availableLocales: () => ['en', 'fr'],
}

describe('availableCommands', () => {
  it('returns only what the principal may invoke', () => {
    const db = fresh()
    createRole(db, 'admins', ['admin.*'])
    const bob = resolvePrincipal(db, { channel: 'console', externalId: 'bob' })
    assignRole(db, bob.id, 'admins')

    const commands = availableCommands(registry(), db, translator, bob, 'en')

    expect(commands.map((c) => c.qualified)).toEqual(['admin.plugins', 'admin.whoami'])
    expect(commands.map((c) => c.qualified)).not.toContain('ping.ping')
  })

  it('returns every command, sorted by qualified, for a principal holding the global wildcard', () => {
    const db = fresh()
    createRole(db, 'owner', ['*'])
    const alice = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    assignRole(db, alice.id, 'owner')

    const commands = availableCommands(registry(), db, translator, alice, 'en')

    expect(commands.map((c) => c.qualified)).toEqual(['admin.plugins', 'admin.whoami', 'ping.ping'])
    expect(commands.map((c) => c.name)).toEqual(['plugins', 'whoami', 'ping'])
    expect(commands.map((c) => c.plugin)).toEqual(['admin', 'admin', 'ping'])
  })

  it('returns nothing for a principal holding no pattern, which is every newcomer', () => {
    const db = fresh()
    const carol = resolvePrincipal(db, { channel: 'console', externalId: 'carol' })

    expect(availableCommands(registry(), db, translator, carol, 'en')).toEqual([])
  })
})

// Design §6: the core renders, because a spore can only render its own domain and the
// domains its manifest requires (i18n/bind.ts). The domain is the command's own plugin,
// never the caller's — a caller-domain lookup would answer raw keys for every command.
describe('availableCommands, descriptions', () => {
  function ownerDb(): { db: Db, alice: Principal } {
    const db = fresh()
    createRole(db, 'owner', ['*'])
    const alice = resolvePrincipal(db, { channel: 'console', externalId: 'alice' })
    assignRole(db, alice.id, 'owner')
    return { db, alice }
  }

  it('renders every description in the requested locale, from the owning spore domain', () => {
    const { db, alice } = ownerDb()

    const fr = availableCommands(registry(), db, translator, alice, 'fr')

    expect(fr.map((c) => c.description)).toEqual([
      'Lister les extensions', 'Qui suis-je', 'Vérification de santé',
    ])
    expect(fr.find((c) => c.name === 'ping')?.description).toBe('Vérification de santé')
  })

  it('renders the same commands in another locale', () => {
    const { db, alice } = ownerDb()

    const en = availableCommands(registry(), db, translator, alice, 'en')

    expect(en.map((c) => c.description)).toEqual(['List plugins', 'Who am I', 'Health check'])
  })

  it('renders each argument description through the declaring plugin, in the asked locale', () => {
    const { db, alice } = ownerDb()

    const fr = availableCommands(registry(), db, translator, alice, 'fr')

    expect(fr.find((c) => c.qualified === 'admin.plugins')?.args).toEqual([
      { name: 'verbose', description: 'Afficher le détail', required: false },
    ])
  })

  it('omits args entirely for a command declaring none', () => {
    const { db, alice } = ownerDb()

    const en = availableCommands(registry(), db, translator, alice, 'en')

    expect(en.find((c) => c.qualified === 'admin.whoami')?.args).toBeUndefined()
  })
})
