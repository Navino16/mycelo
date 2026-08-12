import { expect, it } from 'bun:test'
import type { HyphaContext, IncomingMessage } from '@mycelo/septum'
import module from '../../../../fixtures/console/src/index.js'

function start(): {
  feed: (t: string, externalId?: string) => void
  seen: IncomingMessage[]
  sent: unknown[]
  setGroup: (groupId: string, members: { channel: string; externalId: string }[]) => void
  listGroupMembers: (groupId: string) => Promise<readonly { channel: string; externalId: string }[]>
} {
  const instance = module.create()
  const seen: IncomingMessage[] = []
  void instance.connect({ emit: (m: unknown) => seen.push(m as IncomingMessage) } as unknown as HyphaContext)
  instance.listen()
  return {
    feed: (t: string, externalId?: string) => instance.feed(t, externalId),
    seen,
    sent: instance.sent,
    setGroup: (groupId, members) => instance.setGroup(groupId, members),
    listGroupMembers: (groupId) => instance.listGroupMembers(groupId),
  }
}

it('emits what it is fed, stamped as a console message', () => {
  const { feed, seen } = start()
  feed('/ping')
  expect(seen).toHaveLength(1)
  expect(seen[0]?.channel).toBe('console')
  expect(seen[0]?.text).toBe('/ping')
})

it('gives every message a distinct messageId', () => {
  const { feed, seen } = start()
  feed('one')
  feed('two')
  expect(seen[0]?.messageId).not.toBe(seen[1]?.messageId)
})

it('records what is sent to it', async () => {
  const instance = module.create()
  await instance.send('stdin', { text: 'pong' })
  expect(instance.sent).toEqual([{ text: 'pong' }])
})

it('stamps a fed message with the given sender, defaulting to local', () => {
  const { feed, seen } = start()
  feed('/ping', 'alice')
  feed('/ping')
  expect(seen[0]?.sender).toEqual({ channel: 'console', externalId: 'alice' })
  expect(seen[1]?.sender).toEqual({ channel: 'console', externalId: 'local' })
})

it('reports the seeded household group members', async () => {
  const { listGroupMembers } = start()
  expect(await listGroupMembers('household')).toEqual([
    { channel: 'console', externalId: 'alice' },
    { channel: 'console', externalId: 'bob' },
    { channel: 'console', externalId: 'local' },
  ])
})

it('reports no members for a group it was never told about', async () => {
  const { listGroupMembers } = start()
  expect(await listGroupMembers('ghost')).toEqual([])
})

it('answers a group named after an Object.prototype member with no members, not the native function', async () => {
  const { listGroupMembers } = start()
  expect(await listGroupMembers('constructor')).toEqual([])
})

it('lets a test replace a group\'s membership through setGroup', async () => {
  const { setGroup, listGroupMembers } = start()
  setGroup('household', [{ channel: 'console', externalId: 'carol' }])
  expect(await listGroupMembers('household')).toEqual([{ channel: 'console', externalId: 'carol' }])
})

it('emits nothing before listen() opens the gate', async () => {
  const instance = module.create()
  const seen: IncomingMessage[] = []
  await instance.connect({ emit: (m: unknown) => seen.push(m as IncomingMessage) } as unknown as HyphaContext)
  instance.feed('/before')
  expect(seen).toEqual([])
  instance.listen()
  instance.feed('/after')
  expect(seen).toHaveLength(1)
  expect(seen[0]?.text).toBe('/after')
})
