import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { syncInstalls } from '../src/config/lifecycle.js'
import { writeSetting } from '../src/config/store.js'
import { bootstrap, germinationBanner } from '../src/mycelium.js'
import { migrateDatabase, openDatabase } from '../src/persistence/db.js'
import { waitFor } from './support/wait-for.js'

interface ConsoleFixture {
  feed(text: string, externalId?: string, options?: {
    conversationId?: string
    group?: { id: string, name?: string }
    displayName?: string
  }): void
  setGroup(groupId: string, members: { channel: string, externalId: string }[]): void
  readonly sent: OutgoingContent[]
  readonly deliveries: { conversationId: string, out: OutgoingContent }[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-milestone-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// Writes a setting into the database bootstrap() will itself open. syncInstalls() runs
// first because writeSetting refuses a plugin with no install row, and doing it here
// makes this the first sync, so bootstrap's own finds every spore already enabled.
function seedSetting(databaseFile: string, sporesDir: string, plugin: string, key: string, value: unknown): void {
  const { db, close } = openDatabase(databaseFile)
  migrateDatabase(db)
  syncInstalls(db, sporesDir)
  writeSetting(db, plugin, key, value, false)
  close()
}

it('answers /ping with pong, through the real fixtures and the real bootstrap()', async () => {
  // Exercises boot/index.ts's bootstrap() itself, not a hand-reassembled germinate()/
  // createBus(). `owner` grants the fixture's fixed sender ('local') the owner role:
  // these milestones exercise routing, not authorization.
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

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
    + 'owner:\n  channel: console\n  userId: alice\n',
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
    + 'owner:\n  channel: console\n  userId: alice\n',
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

// The mycelium curates every one of these; before the fixture surfaced them they all
// reached the user as "command '<name>' failed".
it('surfaces the mycelium\'s own diagnostic instead of a generic command failure', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  // A role that does not exist, granted to an identity that does.
  fixture.feed('/grant ghost alice', 'alice')
  await waitFor(() => { expect(fixture.sent[0]).toEqual({ text: "role 'ghost' does not exist" }) })

  fixture.feed('/role-new guest media.* media.*', 'alice')
  await waitFor(() => { expect(fixture.sent[1]).toEqual({ text: "pattern 'media.*' is listed twice" }) })

  fixture.feed('/role-new owner', 'alice')
  await waitFor(() => { expect(fixture.sent[2]).toEqual({ text: "role 'owner' already exists" }) })

  fixture.feed('/role-new', 'alice')
  await waitFor(() => { expect(fixture.sent[3]).toEqual({ text: 'usage: role-new <name> [pattern...]' }) })

  // Nothing above created a role, so /roles still shows only the builtin one.
  fixture.feed('/roles', 'alice')
  await waitFor(() => { expect(fixture.sent[4]).toEqual({ text: 'owner: *' }) })
})

it('lists roles and their patterns through /roles', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n',
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
    + 'owner:\n  channel: console\n  userId: alice\n',
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

it('serves a spore the settings stored in the database, overriding its own default', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n',
    'utf8',
  )

  // gate defaults to 'household', which holds alice and bob; the stored value names a
  // group holding only alice, so bob's fate is what distinguishes the two sources.
  seedSetting(join(dir, 'mycelo.db'), sporesDir, 'gate', 'groupId', 'flatmates')
  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture
  fixture.setGroup('flatmates', [{ channel: 'console', externalId: 'alice' }])

  fixture.feed('/whoami', 'alice')
  await waitFor(() => { expect(fixture.sent[0]).toEqual({ text: 'console:alice roles: owner' }) })

  // bob is a household member and not a flatmate: refused, and a refusal is silent.
  fixture.feed('/whoami', 'bob')
  // alice's reply is the barrier: fed after his, and its path is strictly longer.
  fixture.feed('/whoami', 'alice')
  await waitFor(() => { expect(fixture.sent).toHaveLength(2) })
  expect(fixture.sent[1]).toEqual({ text: 'console:alice roles: owner' })
})

it('runs the phase 5.5 milestone: an operator bounds where a command works and reaches every conversation', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  // 1 — the author's declaration: /react needs reactions, console declares only group_membership.
  fixture.feed('/react', 'alice')
  await waitFor(() => {
    expect(fixture.sent[0]).toEqual({
      text: "'react' needs reactions, which channel 'console' does not provide",
    })
  })

  // 2 — the registry: one DM and one group, each labelled.
  fixture.feed('/whoami', 'alice', { displayName: 'Alice' })
  await waitFor(() => { expect(fixture.sent[1]).toEqual({ text: 'console:alice roles: owner' }) })
  fixture.feed('/whoami', 'alice', { conversationId: 'g:weekend', group: { id: 'g1', name: 'weekend' } })
  await waitFor(() => { expect(fixture.sent[2]).toEqual({ text: 'console:alice roles: owner' }) })

  fixture.feed('/conversations', 'alice')
  await waitFor(() => {
    expect(fixture.sent[3]).toEqual({ text: 'weekend (group)\nAlice (dm)' })
  })

  // 3 — the operator's rule: /whoami is a DM command from now on.
  fixture.feed('/where-rule admin.whoami dm', 'alice')
  await waitFor(() => { expect(fixture.sent[4]).toEqual({ text: "'admin.whoami' is now restricted to dm" }) })

  fixture.feed('/whoami', 'alice', { conversationId: 'g:weekend', group: { id: 'g1', name: 'weekend' } })
  await waitFor(() => {
    expect(fixture.sent[5]).toEqual({ text: "'whoami' is only available in a direct message" })
  })
  fixture.feed('/whoami', 'alice')
  await waitFor(() => { expect(fixture.sent[6]).toEqual({ text: 'console:alice roles: owner' }) })

  // 4 — broadcast reaches a conversation nobody is speaking in.
  fixture.feed('/broadcast-add console g:weekend', 'alice')
  await waitFor(() => { expect(fixture.sent[7]).toEqual({ text: 'added console/g:weekend' }) })

  // Broadcast sends to the group and then replies to the caller: two entries, not one.
  fixture.feed('/broadcast the pub is booked', 'alice')
  await waitFor(() => { expect(fixture.sent).toHaveLength(10) })
  expect(fixture.sent[9]).toEqual({ text: '1 ok, 0 failed' })
  expect(fixture.deliveries.filter((d) => d.conversationId === 'g:weekend').map((d) => d.out))
    .toContainEqual({ text: 'the pub is booked' })

  // 5 — confining the gate to another channel takes it out of console's path: carol, who is
  // not in 'household', is no longer refused in silence but by authorization, which answers.
  fixture.feed('/inhibitor-channels gate signal', 'alice')
  await waitFor(() => { expect(fixture.sent.at(-1)).toEqual({ text: 'gate applies to: signal' }) })

  fixture.feed('/whoami', 'carol')
  await waitFor(() => {
    expect(fixture.sent.at(-1)).toEqual({ text: "you are not allowed to use 'whoami'" })
  })
})

it("reports 'only available in a group' through the real onOutOfContext wiring, not the dm sentence", async () => {
  // boot/start.ts's onOutOfContext builds the catalogue key as `context.${where}`; the
  // milestone above only ever exercises the dm branch, which would pass even with that
  // key hard-coded to 'context.dm'. This drives the group branch through the same
  // real bootstrap() wiring.
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    'prefix: "/"\n'
    + `spores: ${sporesDir}\n`
    + 'owner:\n  channel: console\n  userId: alice\n',
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/where-rule admin.whoami group', 'alice')
  await waitFor(() => { expect(fixture.sent[0]).toEqual({ text: "'admin.whoami' is now restricted to group" }) })

  fixture.feed('/whoami', 'alice')
  await waitFor(() => {
    expect(fixture.sent[1]).toEqual({ text: "'whoami' is only available in a group" })
  })
})
