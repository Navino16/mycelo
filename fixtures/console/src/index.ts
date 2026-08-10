/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import type { HyphaModule, IncomingMessage, OutgoingContent } from '@mycelo/septum'

const CONVERSATION = 'stdin'

export default {
  create: () => {
    let emit: ((message: IncomingMessage) => void) | null = null
    let counter = 0
    const sent: OutgoingContent[] = []
    return {
      sent,
      async start(ctx) {
        emit = ctx.emit
      },
      async stop() {
        emit = null
      },
      async send(_conversationId: string, out: OutgoingContent) {
        sent.push(out)
        if (out.text !== undefined) console.log(`bot: ${out.text}`)
      },
      /** Test seam: what stdin does in the demo, a test does directly. */
      feed(text: string) {
        counter += 1
        emit?.({
          channel: 'console',
          conversationId: CONVERSATION,
          messageId: `m:${String(counter)}`,
          sender: { channel: 'console', externalId: 'local' },
          text,
          attachments: [],
          raw: null,
          receivedAt: new Date(),
        })
      },
    }
  },
} satisfies HyphaModule
