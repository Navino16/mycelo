import type { ChannelIdentity, HyphaModule, HyphaContext, OutgoingContent } from '@mycelo/septum'

const CONVERSATION = 'stdin'

/** Illustrative membership: alice and bob are a household; local is the demo's own sender. */
function defaultGroups(): Record<string, ChannelIdentity[]> {
  return {
    household: [
      { channel: 'console', externalId: 'alice' },
      { channel: 'console', externalId: 'bob' },
      { channel: 'console', externalId: 'local' },
    ],
  }
}

export default {
  create: () => {
    let ctx: HyphaContext<unknown> | null = null
    let counter = 0
    let listening = false
    const sent: OutgoingContent[] = []
    let groups = defaultGroups()
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
      feed(text: string, externalId = 'local') {
        if (!listening) return
        counter += 1
        ctx?.emit({
          channel: 'console',
          conversationId: CONVERSATION,
          messageId: `m:${String(counter)}`,
          sender: { channel: 'console', externalId },
          text,
          attachments: [],
          raw: null,
          receivedAt: new Date(),
        })
      },
      /** Test seam: lets a test replace or extend membership. */
      setGroup(groupId: string, members: ChannelIdentity[]) {
        groups = { ...groups, [groupId]: members }
      },
      listGroupMembers: (groupId: string) =>
        // Object.hasOwn, not a bare index: `groups['constructor']` would otherwise
        // resolve to a native function.
        Promise.resolve(Object.hasOwn(groups, groupId) ? groups[groupId] ?? [] : []),
    }
  },
} satisfies HyphaModule
