import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bootstrap } from '../src/mycelium.js'
import { waitFor } from './support/wait-for.js'

interface ConsoleFixture {
  feed(text: string, externalId?: string): void
  readonly sent: OutgoingContent[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-help-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

it('/help lists commands with their description, not bare names', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/help')
  await waitFor(() => { expect(fixture.sent.length).toBe(1) })
  expect(fixture.sent[0]?.text).toContain('ping')
  // Health check is ping's rendered description, not its bare command name.
  expect(fixture.sent[0]?.text).toContain('Health check')
})

it('/help shows each sender only their own commands', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  // bob's identity does not exist until his first message (admission before principal).
  fixture.feed('/whoami', 'bob')
  await waitFor(() => { expect(fixture.sent.length).toBe(1) })

  // help.help is included so bob can invoke /help at all — a role of admin.* alone
  // would be refused before the handler ever ran.
  fixture.feed('/role-new narrow admin.* help.help', 'local')
  await waitFor(() => { expect(fixture.sent.length).toBe(2) })

  fixture.feed('/grant narrow bob', 'local')
  await waitFor(() => { expect(fixture.sent.length).toBe(3) })

  fixture.feed('/help', 'local') // the owner, per the config's owner: line
  fixture.feed('/help', 'bob') // holds a role granting 'admin.*' and 'help.help' only
  await waitFor(() => { expect(fixture.sent.length).toBe(5) })
  expect(fixture.sent[3]?.text).toContain('ping')
  // Positive as well as negative: a broken filter that answered [] for bob would
  // still satisfy .not.toContain('ping') without ever proving his list is scoped.
  expect(fixture.sent[4]?.text).toContain('whoami')
  expect(fixture.sent[4]?.text).not.toContain('ping')
})

// The phase's headline data path, seam to seam: reader's /lang → ctx.locale →
// available(principal, locale) → rendered description. Every unit was pinned and neither
// seam was, so hardcoding 'en' at either one left the suite green (review, Important 4).
it("renders /help's descriptions in the caller's own language after /lang", async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/lang fr')
  await waitFor(() => { expect(fixture.sent.length).toBe(1) })

  fixture.feed('/help')
  await waitFor(() => { expect(fixture.sent.length).toBe(2) })
  const listed = fixture.sent[1]?.text ?? ''
  // Two plugins' descriptions, not one: a locale collapsed to a single command's domain
  // would still satisfy a single assertion.
  expect(listed).toContain('Vérification de santé')
  expect(listed).toContain('Lister les commandes que vous êtes autorisé à utiliser')
  expect(listed).not.toContain('Health check')
})

// spec §7: available() is given the emitting channel, so the list stops naming a command the
// bus would then refuse. `console` declares group_membership only; ping.react needs reactions.
it('/help omits a command the emitting channel cannot serve', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: console\n  userId: local\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/help')
  await waitFor(() => { expect(fixture.sent.length).toBe(1) })
  const listed = fixture.sent[0]?.text ?? ''

  // Positive first: .not.toContain passes identically on an empty reply.
  expect(listed).toContain('Health check')
  expect(listed).not.toContain('Answer only where reactions exist')
})
