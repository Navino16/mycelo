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

it('refuses a message with undefined conversationId', () => {
  const msg = Object.assign(message(), { conversationId: undefined })
  expect(() => normalize('console', msg)).toThrow('conversationId')
})

it('refuses a message with non-string conversationId', () => {
  const msg = Object.assign(message(), { conversationId: 123 })
  expect(() => normalize('console', msg)).toThrow('conversationId')
})

it('refuses a message with undefined messageId', () => {
  const msg = Object.assign(message(), { messageId: undefined })
  expect(() => normalize('console', msg)).toThrow('messageId')
})

it('refuses a message with non-string messageId', () => {
  const msg = Object.assign(message(), { messageId: 456 })
  expect(() => normalize('console', msg)).toThrow('messageId')
})
