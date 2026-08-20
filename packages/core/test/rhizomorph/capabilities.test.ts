import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bootstrap } from '../../src/mycelium.js'
import { waitFor } from '../support/wait-for.js'

interface ReactiveFixture {
  feed(text: string, externalId?: string): void
  readonly sent: OutgoingContent[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-capabilities-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// The refusal half of this property — a channel missing `reactions` — is
// packages/core/test/milestone.test.ts's phase-5.5 milestone test.
it('a command requiring reactions is accepted on a channel that has them', async () => {
  const sporesDir = resolve(import.meta.dirname, '../../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    `prefix: "/"\nspores: ${sporesDir}\nowner:\n  channel: reactive\n  userId: local\n`,
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'reactive')
    ?.instance as unknown as ReactiveFixture

  fixture.feed('/react')
  await waitFor(() => { expect(fixture.sent).toHaveLength(1) })
  expect(fixture.sent[0]).toEqual({ text: 'reactions are available here' })
})
