import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bootstrap, germinationBanner } from '../src/mycelium.js'
import { waitFor } from './support/wait-for.js'

interface ConsoleFixture {
  feed(text: string, externalId?: string): void
  readonly sent: OutgoingContent[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-milestone-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

it('answers /ping with pong, through the real fixtures and the real bootstrap()', async () => {
  // Exercises mycelium.ts's bootstrap() itself, not a hand-reassembled germinate()/
  // createBus(). `owner` grants the fixture's fixed sender ('local') the owner role:
  // these milestones exercise routing, not authorization.
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const consoleHypha = registry.hyphae.find((h) => h.name === 'console')
  const fixture = consoleHypha?.instance as unknown as ConsoleFixture

  fixture.feed('/ping')
  await waitFor(() => { expect(fixture.sent).toEqual([{ text: 'pong' }]) })
})

it('answers text and code commands from one plugin, sharing a handler', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/links')
  fixture.feed('/add Dune')
  fixture.feed('/remove Dune')

  await waitFor(() => {
    expect(fixture.sent).toEqual([
      { text: 'Radarr http://radarr:7878' },
      { text: 'add: Dune' },
      { text: 'remove: Dune' },
    ])
  })
})

it('answers from a plugin split across two unbundled files', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/two Bun')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'hello Bun from a second file' }])
  })
})

it('answers a lookup through a rhiza resolved via an any_of collapse', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/movies Dune')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'Dune (2021) via mock' }])
  })
})

it('answers unknown for a title that collides with an Object.prototype member', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/movies toString')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'toString (unknown) via mock' }])
  })
})

it('collapses an any_of to the first installed alternative', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/where')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'resolved to mock (nowhere is absent)' }])
  })
})

it('reads the mycelium through a scoped rhiza', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\nplugins:\n  gate:\n    channel: console\n    groupId: household\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/plugins')
  await waitFor(() => {
    expect(fixture.sent).toEqual([
      { text: 'console, admin, helpdesk, media, ping, twofile, mock, gate' },
    ])
  })
})

it('gates admission by group membership and grants/revokes roles through admin', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n'
    + 'plugins:\n  gate:\n    channel: console\n    groupId: household\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  // alice is the owner (pattern '*') and a household member: admitted and authorized.
  fixture.feed('/whoami', 'alice')
  // carol is not a household member: gate refuses her, silently, before any reply.
  fixture.feed('/whoami', 'carol')
  // bob is a household member but holds no role yet: admitted, then denied.
  fixture.feed('/whoami', 'bob')
  await waitFor(() => {
    expect(fixture.sent).toEqual([
      { text: 'console:alice roles: owner' },
      { text: "you are not allowed to use 'whoami'" },
    ])
  })

  fixture.feed('/role-new guest admin.whoami', 'alice')
  await waitFor(() => {
    expect(fixture.sent[2]).toEqual({ text: "created role 'guest' with patterns: admin.whoami" })
  })

  fixture.feed('/grant guest bob', 'alice')
  await waitFor(() => {
    expect(fixture.sent[3]).toEqual({ text: "granted 'guest' to bob" })
  })

  fixture.feed('/whoami', 'bob')
  await waitFor(() => {
    expect(fixture.sent[4]).toEqual({ text: 'console:bob roles: guest' })
  })

  // guest only grants admin.whoami: a command outside that pattern is still denied.
  fixture.feed('/plugins', 'bob')
  await waitFor(() => {
    expect(fixture.sent[5]).toEqual({ text: "you are not allowed to use 'plugins'" })
  })

  fixture.feed('/revoke guest bob', 'alice')
  await waitFor(() => {
    expect(fixture.sent[6]).toEqual({ text: "revoked 'guest' from bob" })
  })

  fixture.feed('/whoami', 'bob')
  await waitFor(() => {
    expect(fixture.sent[7]).toEqual({ text: "you are not allowed to use 'whoami'" })
  })
})

it('reports a clear failure granting a role to an identity the mycelium has never seen', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n'
    + 'plugins:\n  gate:\n    channel: console\n    groupId: household\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/grant guest bob', 'alice')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: "no identity 'bob' on channel 'console'" }])
  })
})

it('lists roles and their patterns through /roles', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n'
    + 'plugins:\n  gate:\n    channel: console\n    groupId: household\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/roles', 'alice')
  await waitFor(() => { expect(fixture.sent).toEqual([{ text: 'owner: *' }]) })

  fixture.feed('/role-new guest admin.whoami admin.plugins', 'alice')
  await waitFor(() => { expect(fixture.sent).toHaveLength(2) })

  fixture.feed('/roles', 'alice')
  await waitFor(() => {
    // roleCommand carries no ordering guarantee across its two rows, so patterns are
    // compared as a set rather than as an exact joined string.
    const text = (fixture.sent[2] as { text?: string }).text ?? ''
    expect(text.startsWith('owner: *; guest: ')).toBe(true)
    const patterns = text.slice('owner: *; guest: '.length).split(', ')
    expect(new Set(patterns)).toEqual(new Set(['admin.whoami', 'admin.plugins']))
  })
})

it('runs the phase 4 milestone: gate admits, media stays denied until granted, carol never touches the db', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n'
    + 'plugins:\n  gate:\n    channel: console\n    groupId: household\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])
  expect(germinationBanner(registry)).toBe(
    'germinated 8 spores (console, admin, helpdesk, media, ping, twofile, mock, gate)',
  )

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/whoami', 'alice')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'console:alice roles: owner' }])
  })

  // bob is a household member but holds no role yet: an explicit refusal, not silence.
  fixture.feed('/movies Dune', 'bob')
  await waitFor(() => {
    expect(fixture.sent[1]).toEqual({ text: "you are not allowed to use 'movies'" })
  })

  fixture.feed('/role-new guest media.*', 'alice')
  await waitFor(() => {
    expect(fixture.sent[2]).toEqual({ text: "created role 'guest' with patterns: media.*" })
  })

  fixture.feed('/grant guest bob', 'alice')
  await waitFor(() => {
    expect(fixture.sent[3]).toEqual({ text: "granted 'guest' to bob" })
  })

  fixture.feed('/movies Dune', 'bob')
  await waitFor(() => {
    expect(fixture.sent[4]).toEqual({ text: 'Dune (2021) via mock' })
  })

  // carol is not in 'household': the gate refuses her before identity resolution runs,
  // so nothing is sent and no row for her is ever written to channel_identity.
  fixture.feed('/movies Dune', 'carol')
  // A refusal is silent, so waiting on carol's own output would return immediately and
  // read the database before her delivery had even reached admission. bob's next reply is
  // the barrier: fed after hers, and its path is strictly longer than a refusal's.
  fixture.feed('/movies Solaris', 'bob')
  await waitFor(() => {
    expect(fixture.sent[5]).toEqual({ text: 'Solaris (unknown) via mock' })
  })
  expect(fixture.sent).toHaveLength(6)

  const db = new Database(join(dir, 'mycelo.db'), { readonly: true })
  const identities = db.query('select channel, external_id from channel_identity').all() as
    { channel: string, external_id: string }[]
  expect(new Set(identities.map((i) => i.external_id))).toEqual(new Set(['alice', 'bob']))
  const roles = db.query('select name, builtin from role').all() as
    { name: string, builtin: number }[]
  expect(new Set(roles.map((r) => r.name))).toEqual(new Set(['owner', 'guest']))
  db.close()
})
