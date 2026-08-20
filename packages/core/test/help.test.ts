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

it('/help lists command names', async () => {
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
})
