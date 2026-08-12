import type { HyphaModule, HyphaContext, OutgoingContent } from '@mycelo/septum'

const CONVERSATION = 'stdin'

export default {
  create: () => {
    let ctx: HyphaContext<unknown> | null = null
    let counter = 0
    let listening = false
    const sent: OutgoingContent[] = []
    return {
      sent,
      connect: (context: HyphaContext<unknown>) => {
        ctx = context
        return Promise.resolve()
      },
      listen: () => {
        listening = true
      },
      stop: () => {
        ctx = null
        listening = false
        return Promise.resolve()
      },
      send: (_conversationId: string, out: OutgoingContent) => {
        sent.push(out)
        if (out.text !== undefined) console.log(`bot: ${out.text}`)
        return Promise.resolve()
      },
      /** Test seam: what stdin does in the demo, a test does directly. */
      feed(text: string) {
        if (!listening) return
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
