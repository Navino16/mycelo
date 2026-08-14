import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bindTranslate } from '../../src/i18n/bind.js'
import type { Translator } from '../../src/i18n/translator.js'
import { bootstrap } from '../../src/mycelium.js'
import { waitFor } from '../support/wait-for.js'

interface ConsoleFixture {
  feed(text: string, externalId?: string): void
  readonly sent: OutgoingContent[]
}

const sporesDir = resolve(import.meta.dirname, '../../../../fixtures')

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-media-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

async function bootstrapWithLocale(locale: string) {
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    `prefix: "/"\nspores: ${sporesDir}\ndefaultLocale: ${locale}\nowner:\n  channel: console\n  userId: local\n`,
    'utf8',
  )
  return bootstrap(configFile)
}

it('renders a rhiza\'s ref in the reader\'s language, through the declaring manifest', async () => {
  // /movies Arrakis — mock holds no such title, so it answers a ref, and media resolves it
  // in mock's domain because its manifest requires mock.
  const { registry } = await bootstrapWithLocale('fr')
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')?.instance as unknown as ConsoleFixture
  fixture.feed('/movies Arrakis')
  await waitFor(() => {
    expect(fixture.sent).toEqual([{ text: 'Arrakis (inconnu) via mock' }])
  })
})

it('counts in Russian, reaching the many form', async () => {
  const { registry } = await bootstrapWithLocale('ru')
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')?.instance as unknown as ConsoleFixture
  fixture.feed('/count 1')
  fixture.feed('/count 3')
  fixture.feed('/count 5')
  await waitFor(() => {
    expect(fixture.sent).toEqual([
      { text: '1 фильм' },
      { text: '3 фильма' },
      { text: '5 фильмов' },
    ])
  })
})

it('refuses a ref outside media\'s own declared domains, pinning the permission in the real manifest', async () => {
  // Unlike bind.test.ts, `allowed` here comes from germinating media's actual spore.yaml,
  // not a hand-typed set — this is what pins the permission at the fixture level.
  const { registry } = await bootstrapWithLocale('en')
  const media = registry.enzymes.find((e) => e.name === 'media')
  if (media === undefined) throw new Error('media did not germinate')

  const translator: Translator = {
    translate: () => { throw new Error('translator must not be reached for a refused domain') },
    availableLocales: () => [],
  }
  const t = bindTranslate({ translator, domain: 'media', allowed: media.resolved, localeOf: () => 'en' })
  expect(() => t({ domain: 'helpdesk', key: 'links.text' })).toThrow(/helpdesk.*not declared/)
})
