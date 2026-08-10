import { expect, it } from 'vitest'
import type { HyphaContext, IncomingMessage } from '@mycelo/septum'
import module from '../../../../fixtures/console/src/index.js'

function start(): { feed: (t: string) => void; seen: IncomingMessage[]; sent: unknown[] } {
  const instance = module.create()
  const seen: IncomingMessage[] = []
  void instance.start({ emit: (m: unknown) => seen.push(m as IncomingMessage) } as unknown as HyphaContext)
  return { feed: (t: string) => instance.feed(t), seen, sent: instance.sent }
}

it('emits what it is fed, stamped as a console message', () => {
  const { feed, seen } = start()
  feed('/ping')
  expect(seen).toHaveLength(1)
  expect(seen[0]?.channel).toBe('console')
  expect(seen[0]?.text).toBe('/ping')
})

it('gives every message a distinct messageId', () => {
  const { feed, seen } = start()
  feed('one')
  feed('two')
  expect(seen[0]?.messageId).not.toBe(seen[1]?.messageId)
})

it('records what is sent to it', async () => {
  const instance = module.create()
  await instance.send('stdin', { text: 'pong' })
  expect(instance.sent).toEqual([{ text: 'pong' }])
})

import { readFileSync } from 'node:fs'
import { erasabilityError } from '@mycelo/septum/conformance'

it('is loadable by the local driver', () => {
  const source = readFileSync(new URL('../../../../fixtures/console/src/index.ts', import.meta.url), 'utf8')
  expect(erasabilityError(source)).toBeNull()
})
