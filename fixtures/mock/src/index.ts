import type { RhizaModule, TranslatableRef } from '@mycelo/septum'

export interface MockApi {
  lookup(title: string): string | TranslatableRef
}

const TITLES = new Map<string, string>([['Dune', 'Dune (2021)']])

export default {
  create: () => ({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    health: () => Promise.resolve({ state: 'healthy' as const, checkedAt: new Date() }),
    api: {
      // A rhiza has no recipient and so cannot resolve a locale: it names the message and
      // lets the enzyme render it (design §3, §5.3).
      lookup: (title: string): string | TranslatableRef =>
        TITLES.get(title) ?? { domain: 'mock', key: 'lookup.unknown', params: { title } },
    },
  }),
} satisfies RhizaModule<unknown, MockApi>
