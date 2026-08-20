import type { ChannelIdentity, HyphaModule, HyphaContext, OutgoingContent } from '@mycelo/septum'

const CONVERSATION = 'stdin'

interface FeedOptions {
  conversationId?: string
  group?: { id: string, name?: string }
  displayName?: string
}

/** Illustrative membership: alice and bob are a household; local is the demo's own sender. */
function defaultGroups(): Record<string, ChannelIdentity[]> {
  return {
    household: [
      { channel: 'reactive', externalId: 'alice' },
      { channel: 'reactive', externalId: 'bob' },
      { channel: 'reactive', externalId: 'local' },
    ],
  }
}

export default {
  create: () => {
    let ctx: HyphaContext<unknown> | null = null
    let counter = 0
    let listening = false
    const sent: OutgoingContent[] = []
    const deliveries: { conversationId: string, out: OutgoingContent }[] = []
    let groups = defaultGroups()
    return {
      sent,
      deliveries,
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
      send: (conversationId: string, out: OutgoingContent) => {
        sent.push(out)
        deliveries.push({ conversationId, out })
        if (out.text !== undefined) console.log(`reactive: ${out.text}`)
        return Promise.resolve()
      },
      /** Test seam: what stdin does in the demo, a test does directly. */
      feed(text: string, externalId = 'local', options: FeedOptions = {}) {
        if (!listening) return
        counter += 1
        ctx?.emit({
          channel: 'reactive',
          conversationId: options.conversationId ?? CONVERSATION,
          messageId: `m:${String(counter)}`,
          ...(options.group === undefined ? {} : { group: options.group }),
          sender: {
            channel: 'reactive',
            externalId,
            ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
          },
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
