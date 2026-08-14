import { and, eq } from 'drizzle-orm'
import type { PushTarget } from '@mycelo/septum'
import type { Db } from '../persistence/db.js'
import { conversation, principal } from '../persistence/schema.js'

/** Native rather than a hand-written list: Intl rejects a malformed BCP-47 tag on its own. */
export function canonicalLocale(locale: string): string {
  try {
    const [only] = Intl.getCanonicalLocales(locale)
    if (only === undefined) throw new RangeError('empty locale tag')
    return only
  } catch {
    throw new Error(`'${locale}' is not a valid language tag`)
  }
}

function conversationLocale(db: Db, channel: string, conversationId: string): string | null {
  const row = db.select({ locale: conversation.locale }).from(conversation)
    .where(and(eq(conversation.channel, channel), eq(conversation.conversationId, conversationId)))
    .get()
  return row?.locale ?? null
}

export function resolveLocale(
  db: Db, channel: string, conversationId: string, principalId: string, fallback: string,
): string {
  const inConversation = conversationLocale(db, channel, conversationId)
  if (inConversation !== null) return inConversation
  const row = db.select({ locale: principal.locale }).from(principal)
    .where(eq(principal.id, principalId)).get()
  return row?.locale ?? fallback
}

export function localeForTarget(db: Db, target: PushTarget, fallback: string): string {
  return conversationLocale(db, target.channel, target.conversationId) ?? fallback
}

export function setPrincipalLocale(db: Db, principalId: string, locale: string): void {
  const canonical = canonicalLocale(locale)
  const row = db.select({ id: principal.id }).from(principal).where(eq(principal.id, principalId)).get()
  if (row === undefined) throw new Error(`principal '${principalId}' does not exist`)
  db.update(principal).set({ locale: canonical }).where(eq(principal.id, principalId)).run()
}

export function setConversationLocale(
  db: Db, channel: string, conversationId: string, locale: string,
): void {
  const canonical = canonicalLocale(locale)
  const row = db.select({ channel: conversation.channel }).from(conversation)
    .where(and(eq(conversation.channel, channel), eq(conversation.conversationId, conversationId)))
    .get()
  if (row === undefined) {
    throw new Error(`conversation '${conversationId}' on channel '${channel}' has never been seen`)
  }
  db.update(conversation).set({ locale: canonical })
    .where(and(eq(conversation.channel, channel), eq(conversation.conversationId, conversationId)))
    .run()
}
