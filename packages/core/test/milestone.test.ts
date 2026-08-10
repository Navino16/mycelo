import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { OutgoingContent } from '@mycelo/septum'
import { germinate } from '../src/germination/germinate.js'
import { createBus } from '../src/rhizomorph/bus.js'
import { createLogger } from '../src/support/logger.js'

interface ConsoleFixture {
  feed(text: string): void
  readonly sent: OutgoingContent[]
}

it('answers /ping with pong, through the real fixtures', async () => {
  const logger = createLogger()
  const registry = await germinate(resolve(import.meta.dirname, '../../../fixtures'), logger)
  expect(registry.dormant).toEqual([])

  const bus = createBus({ registry, prefix: '/', logger })
  const consoleHypha = registry.hyphae.find((h) => h.name === 'console')
  const fixture = consoleHypha?.instance as unknown as ConsoleFixture

  await consoleHypha?.instance.start({
    config: {},
    logger,
    emit: (message) => { void bus.deliver('console', message) },
  })

  fixture.feed('/ping')
  await vi.waitFor(() => { expect(fixture.sent).toEqual([{ text: 'pong' }]) })
})
