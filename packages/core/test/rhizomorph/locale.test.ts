import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { OutgoingContent } from '@mycelo/septum'
import { bootstrap } from '../../src/mycelium.js'
import { waitFor } from '../support/wait-for.js'

interface ConsoleFixture {
  feed(text: string, externalId?: string): void
  readonly sent: OutgoingContent[]
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-locale-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

// design §5.4: ctx.locale answers the reader's own resolved locale, unlike
// ctx.localeFor(target), which answers a push target's stored locale and never the /lang choice.
it('ctx.locale is the locale resolved for the message, not the conversation default', async () => {
  spore('whichlocale', {
    'spore.yaml': [
      'kind: enzyme',
      'name: whichlocale',
      'septum: "^0.10"',
      'commands:',
      '  - name: whichlocale',
      '    description: x',
      '    code: whichlocale',
      '',
    ].join('\n'),
    'src/index.ts': [
      'export default {',
      '  create: () => ({',
      '    handlers: {',
      '      whichlocale: async (_invocation, ctx) => { await ctx.reply({ text: ctx.locale }) },',
      '    },',
      '  }),',
      '}',
    ].join('\n'),
  })
  const fixturesDir = resolve(import.meta.dirname, '../../../../fixtures')
  const configFile = join(dir, 'mycelo.yaml')
  writeFileSync(
    configFile,
    `prefix: "/"\nspores: [${dir}, ${fixturesDir}]\nowner:\n  channel: console\n  userId: local\n`,
    'utf8',
  )

  const { registry } = await bootstrap(configFile)
  expect(registry.dormant).toEqual([])

  const fixture = registry.hyphae.find((h) => h.name === 'console')
    ?.instance as unknown as ConsoleFixture

  fixture.feed('/lang fr')
  await waitFor(() => { expect(fixture.sent.length).toBe(1) })
  fixture.feed('/whichlocale')
  await waitFor(() => { expect(fixture.sent.length).toBe(2) })
  expect(fixture.sent[1]?.text).toBe('fr')
})
