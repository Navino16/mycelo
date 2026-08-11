import { expect, it } from 'bun:test'
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

it('refuses a message with undefined text', () => {
  // The natural shape of an image-only message on Discord, Signal and WhatsApp:
  // parseCommand(message.text, ...) in bus.ts calls text.startsWith() as its first
  // statement, so an unguarded undefined here becomes a raw TypeError one call later.
  const msg = Object.assign(message(), { text: undefined })
  expect(() => normalize('console', msg)).toThrow('text')
})

it('refuses a message with non-string text', () => {
  const msg = Object.assign(message(), { text: 123 })
  expect(() => normalize('console', msg)).toThrow('text')
})

it('accepts an empty string text, unlike conversationId and messageId', () => {
  expect(() => normalize('console', message({ text: '' }))).not.toThrow()
})

it('refuses a message with undefined attachments', () => {
  const msg = Object.assign(message(), { attachments: undefined })
  expect(() => normalize('console', msg)).toThrow('attachments')
})

it('refuses a message with non-array attachments', () => {
  const msg = Object.assign(message(), { attachments: 'nope' })
  expect(() => normalize('console', msg)).toThrow('attachments')
})
