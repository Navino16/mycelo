import { describe, expect, it } from 'bun:test'
import type { IncomingMessage } from '@mycelo/septum'
import {
  addBroadcastTarget, conversationKind, listBroadcastTargets, listConversations,
  recordConversation, removeBroadcastTarget,
} from '../../src/conversations/registry.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'

function fresh() {
  const persistence = openDatabase(':memory:')
  migrateDatabase(persistence.db)
  return persistence
}

function message(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channel: 'console',
    conversationId: 'c1',
    messageId: 'm1',
    sender: { channel: 'console', externalId: 'alice', displayName: 'Alice' },
    text: '/ping',
    attachments: [],
    raw: null,
    receivedAt: new Date(1_700_000_000_000),
    ...over,
  }
}

describe('conversationKind', () => {
  it('reads a message with no group as a dm and one with a group as a group', () => {
    expect(conversationKind(message())).toBe('dm')
    expect(conversationKind(message({ group: { id: 'g1' } }))).toBe('group')
  })
})

describe('recordConversation', () => {
  it('labels a dm with the sender display name and a group with the group name', () => {
    const { db, close } = fresh()
    recordConversation(db, message())
    recordConversation(db, message({ conversationId: 'c2', group: { id: 'g1', name: 'weekend' } }))
    const rows = listConversations(db)
    close()
    expect(rows).toHaveLength(2)
    expect(rows.find((c) => c.conversationId === 'c1')).toMatchObject({ kind: 'dm', label: 'Alice' })
    expect(rows.find((c) => c.conversationId === 'c2')).toMatchObject({ kind: 'group', label: 'weekend' })
  })

  it('keeps first_seen_at and moves last_message_at on a second message', () => {
    const { db, close } = fresh()
    recordConversation(db, message())
    recordConversation(db, message({ messageId: 'm2', receivedAt: new Date(1_700_000_060_000) }))
    const rows = listConversations(db)
    close()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.firstSeenAt.getTime()).toBe(1_700_000_000_000)
    expect(rows[0]?.lastMessageAt.getTime()).toBe(1_700_000_060_000)
  })

  it('does not erase a known label when a later message carries none', () => {
    const { db, close } = fresh()
    recordConversation(db, message({ group: { id: 'g1', name: 'weekend' } }))
    recordConversation(db, message({ messageId: 'm2', group: { id: 'g1' } }))
    const rows = listConversations(db)
    close()
    expect(rows[0]?.label).toBe('weekend')
  })

  it('replaces a known label when a later message carries a different one', () => {
    const { db, close } = fresh()
    recordConversation(db, message({ group: { id: 'g1', name: 'weekend' } }))
    recordConversation(db, message({ messageId: 'm2', group: { id: 'g1', name: 'renamed' } }))
    const rows = listConversations(db)
    close()
    expect(rows[0]?.label).toBe('renamed')
  })

  it('updates kind when a later message on the same conversation differs from the first', () => {
    const { db, close } = fresh()
    recordConversation(db, message())
    recordConversation(db, message({ messageId: 'm2', group: { id: 'g1', name: 'now-a-group' } }))
    const rows = listConversations(db)
    close()
    expect(rows[0]?.kind).toBe('group')
  })

  it('omits label entirely when the channel has never given one', () => {
    const { db, close } = fresh()
    recordConversation(db, message({ sender: { channel: 'console', externalId: 'alice' } }))
    const rows = listConversations(db)
    close()
    expect(rows[0]?.label).toBeUndefined()
  })
})

describe('broadcast targets', () => {
  it('adds idempotently, lists and removes', () => {
    const { db, close } = fresh()
    const target = { channel: 'console', conversationId: 'c1' }
    addBroadcastTarget(db, target)
    addBroadcastTarget(db, target)
    expect(listBroadcastTargets(db)).toEqual([target])
    removeBroadcastTarget(db, target)
    removeBroadcastTarget(db, target)
    const after = listBroadcastTargets(db)
    close()
    expect(after).toEqual([])
  })

  it('removes only the matching target, leaving one sharing its channel and one sharing its conversation id', () => {
    const { db, close } = fresh()
    const target = { channel: 'console', conversationId: 'c1' }
    const sameChannel = { channel: 'console', conversationId: 'c2' }
    const sameConversationId = { channel: 'signal', conversationId: 'c1' }
    addBroadcastTarget(db, target)
    addBroadcastTarget(db, sameChannel)
    addBroadcastTarget(db, sameConversationId)
    removeBroadcastTarget(db, target)
    const after = listBroadcastTargets(db)
    close()
    expect(after).toEqual([sameChannel, sameConversationId])
  })
})
