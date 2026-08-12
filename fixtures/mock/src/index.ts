import type { RhizaModule } from '@mycelo/septum'

export interface MockApi {
  lookup(title: string): string
}

const TITLES = new Map<string, string>([['Dune', 'Dune (2021)']])

export default {
  create: () => ({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    health: () => Promise.resolve({ state: 'healthy' as const, checkedAt: new Date() }),
    api: {
      lookup: (title: string) => TITLES.get(title) ?? `${title} (unknown)`,
    },
  }),
} satisfies RhizaModule<unknown, MockApi>
