import { and, asc, eq } from 'drizzle-orm'
import type { ConversationInfo, ConversationKind, IncomingMessage, PushTarget } from '@mycelo/septum'
import type { Db } from '../persistence/db.js'
import { broadcastTarget, conversation } from '../persistence/schema.js'

export function conversationKind(message: IncomingMessage): ConversationKind {
  return message.group === undefined ? 'dm' : 'group'
}

/** A group's platform name, or the sender's display name for a DM. */
function labelOf(message: IncomingMessage): string | undefined {
  return message.group === undefined ? message.sender.displayName : message.group.name
}

/**
 * One upsert per admitted message. The label is only overwritten when the new message
 * carries one: a platform that omits it intermittently would otherwise blank a good label.
 */
export function recordConversation(db: Db, message: IncomingMessage): void {
  const label = labelOf(message)
  db.insert(conversation)
    .values({
      channel: message.channel,
      conversationId: message.conversationId,
      kind: conversationKind(message),
      label: label ?? null,
      firstSeenAt: message.receivedAt,
      lastMessageAt: message.receivedAt,
    })
    .onConflictDoUpdate({
      target: [conversation.channel, conversation.conversationId],
      set: {
        kind: conversationKind(message),
        lastMessageAt: message.receivedAt,
        ...(label === undefined ? {} : { label }),
      },
    })
    .run()
}

export function listConversations(db: Db): readonly ConversationInfo[] {
  return db.select().from(conversation)
    .orderBy(asc(conversation.channel), asc(conversation.conversationId))
    .all()
    .map((row) => ({
      channel: row.channel,
      conversationId: row.conversationId,
      kind: row.kind,
      ...(row.label === null ? {} : { label: row.label }),
      firstSeenAt: row.firstSeenAt,
      lastMessageAt: row.lastMessageAt,
    }))
}

export function listBroadcastTargets(db: Db): readonly PushTarget[] {
  return db.select().from(broadcastTarget)
    .orderBy(asc(broadcastTarget.channel), asc(broadcastTarget.conversationId))
    .all()
    .map((row) => ({ channel: row.channel, conversationId: row.conversationId }))
}

export function addBroadcastTarget(db: Db, target: PushTarget): void {
  db.insert(broadcastTarget)
    .values({ channel: target.channel, conversationId: target.conversationId })
    .onConflictDoNothing()
    .run()
}

export function removeBroadcastTarget(db: Db, target: PushTarget): void {
  db.delete(broadcastTarget)
    .where(and(
      eq(broadcastTarget.channel, target.channel),
      eq(broadcastTarget.conversationId, target.conversationId),
    ))
    .run()
}
