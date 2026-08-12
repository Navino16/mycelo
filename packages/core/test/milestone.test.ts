import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bootstrap } from '../src/mycelium.js'
import { waitFor } from './support/wait-for.js'

interface ConsoleFixture {
  feed(text: string): void
  readonly sent: OutgoingContent[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-milestone-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

it('answers /ping with pong, through the real fixtures and the real bootstrap()', async () => {
  // Exercises mycelium.ts's bootstrap() itself — the exact wiring src/index.ts runs —
  // rather than reassembling germinate()/createBus() by hand, which would test a
  // second, parallel implementation of the wiring instead of the shipped one.
  const sporesDir = resolve(import.meta.dirname, '../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

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
  writeFileSync(configFile, `prefix: "/"\nspores: ${sporesDir}\n`, 'utf8')

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/plugins')
  await waitFor(() => {
    expect(fixture.sent).toEqual([
      { text: 'console, admin, helpdesk, media, ping, twofile, mock' },
    ])
  })
})
