import { expect, it } from 'vitest'
import type { IncomingMessage } from '@mycelo/septum'
import { normalize } from '../../src/rhizomorph/normalize.js'

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channel: 'lying', conversationId: 'c:1', messageId: 'm:1',
    sender: { channel: 'console', externalId: 'local' },
    text: 'hello', attachments: [], raw: null, receivedAt: new Date(0),
    ...overrides,
  }
}

it('stamps the emitting channel over whatever the hypha claimed', () => {
  expect(normalize('console', message()).channel).toBe('console')
})

it('refuses a message with no conversationId', () => {
  expect(() => normalize('console', message({ conversationId: '' })))
    .toThrow('conversationId')
})

it('refuses a message with no messageId', () => {
  expect(() => normalize('console', message({ messageId: '' })))
    .toThrow('messageId')
})
