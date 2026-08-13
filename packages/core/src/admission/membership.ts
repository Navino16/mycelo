import type { ChannelCapability, ChannelIdentity } from '@mycelo/septum'
import type { GerminatedHypha } from '../germination/registry.js'

export interface MembershipOptions {
  ttlMs?: number
  now?: () => number
  maxEntries?: number
}

export interface MembershipCache {
  members(channel: string, groupId: string): Promise<readonly ChannelIdentity[] | null>
  requireCapability(channel: string, capability: ChannelCapability): void
}

interface Entry {
  at: number
  members: readonly ChannelIdentity[]
}

const DEFAULT_TTL_MS = 60_000
// Far above any real operator's (channel, group) count, low enough to bound memory.
const DEFAULT_MAX_ENTRIES = 512

/** Querying the channel on every message is not viable (spec §5.1), hence the TTL. */
export function createMembershipCache(
  hyphae: readonly GerminatedHypha[],
  options: MembershipOptions = {},
): MembershipCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? ((): number => Date.now())
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const byName = new Map(hyphae.map((h) => [h.name, h]))
  const cache = new Map<string, Entry>()

  return {
    async members(channel, groupId) {
      const hypha = byName.get(channel)
      if (hypha === undefined) return null
      if (!hypha.manifest.capabilities.includes('group_membership')) return null
      if (hypha.instance.listGroupMembers === undefined) return null
      const key = `${channel} ${groupId}`
      const hit = cache.get(key)
      if (hit !== undefined && now() - hit.at < ttlMs) return hit.members
      // Awaited before caching, so a rejection is never stored and a transient
      // outage is retried on the next message.
      const returned: unknown = await hypha.instance.listGroupMembers(groupId)
      // The published contract promises an array or null, but this is plugin code: an
      // inhibitor written to the contract checks `=== null` and would throw on .some().
      if (!Array.isArray(returned)) return null
      const members = returned as readonly ChannelIdentity[]
      cache.set(key, { at: now(), members })
      // Insertion-ordered Map: the oldest (channel, group) pair is evicted first.
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return members
    },
    requireCapability(channel, capability) {
      const hypha = byName.get(channel)
      if (hypha === undefined) {
        throw new Error(`no channel named '${channel}': cannot require capability '${capability}'`)
      }
      if (!hypha.manifest.capabilities.includes(capability)) {
        throw new Error(`channel '${channel}' cannot enforce a rule requiring capability '${capability}'`)
      }
    },
  }
}
