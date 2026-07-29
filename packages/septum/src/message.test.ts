import { describe, expect, it } from 'vitest'
import type { Attachment, IncomingMessage, OutgoingContent } from './message.js'

describe('message model', () => {
  it('accepts a complete inbound message', () => {
    const msg: IncomingMessage = {
      channel: 'signal',
      conversationId: 'group:abc=',
      messageId: '1730000000123',
      group: { id: 'abc=' },
      sender: { channel: 'signal', externalId: '+33600000000', displayName: 'Nils' },
      text: '/upcoming',
      attachments: [],
      raw: { envelope: {} },
      receivedAt: new Date(0),
    }
    expect(msg.group?.id).toBe('abc=')
  })

  it('accepts a direct message with no group', () => {
    const msg: IncomingMessage = {
      channel: 'console',
      conversationId: 'stdin',
      messageId: '1',
      sender: { channel: 'console', externalId: 'local' },
      text: 'hello',
      attachments: [],
      raw: null,
      receivedAt: new Date(0),
    }
    expect(msg.group).toBeUndefined()
  })

  it('discriminates attachment kinds', () => {
    const items: Attachment[] = [
      { kind: 'url', url: 'https://example.test/poster.jpg' },
      // A Node Buffer is assignable to Uint8Array, so plugins can pass either.
      { kind: 'bytes', data: Buffer.from('x'), mime: 'image/png', filename: 'p.png' },
    ]
    const kinds = items.map((a) => (a.kind === 'url' ? a.url : a.filename))
    expect(kinds).toEqual(['https://example.test/poster.jpg', 'p.png'])
  })

  it('allows a reaction-only outgoing message', () => {
    const out: OutgoingContent = { reactTo: { messageId: '1', emoji: '✅' } }
    expect(out.text).toBeUndefined()
  })
})
