import type { HyphaModule, HyphaContext, OutgoingContent } from '@mycelo/septum'

const CONVERSATION = 'stdin'

export default {
  create: () => {
    let ctx: HyphaContext<unknown> | null = null
    let counter = 0
    const sent: OutgoingContent[] = []
    return {
      sent,
      start: (context: HyphaContext<unknown>) => {
        ctx = context
        return Promise.resolve()
      },
      stop: () => {
        ctx = null
        return Promise.resolve()
      },
      send: (_conversationId: string, out: OutgoingContent) => {
        sent.push(out)
        if (out.text !== undefined) console.log(`bot: ${out.text}`)
        return Promise.resolve()
      },
      /** Test seam: what stdin does in the demo, a test does directly. */
      feed(text: string) {
        counter += 1
        ctx?.emit({
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
