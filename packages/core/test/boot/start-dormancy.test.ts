import { describe, expect, it } from 'bun:test'
import type { Enzyme, Hypha, Inhibitor, Rhiza } from '@mycelo/septum'
import { startMycelium } from '../../src/boot/start.js'
import type { RuntimeState } from '../../src/boot/state.js'
import type {
  GerminatedEnzyme, GerminatedHypha, GerminatedInhibitor, GerminatedRhiza, Registry,
} from '../../src/germination/registry.js'
import { SHARED_DOMAIN } from '../../src/i18n/core-catalogs.js'
import { freshDb } from '../support/db.js'
import { silentLogger } from '../support/logger.js'
import { emptyRegistry } from '../support/registry.js'

// startMycelium only destructures { config, db, translator } (task 6 resolutions); a real
// db is required because the routed registry always calls listAliases(db).
function stateWith(db: RuntimeState['db']): RuntimeState {
  return {
    config: {
      sporesDirs: ['/none'], discoveryDirs: ['/none'], managedRoot: '/none/spores',
      prefix: '/', defaultLocale: 'en',
    },
    db,
    translator: { has: () => false, translate: (k: string) => k },
  } as unknown as RuntimeState
}

function connectThrowingHypha(name: string, detail: string): GerminatedHypha {
  const instance: Hypha = {
    connect: async () => { throw new Error(detail) },
    listen: () => {},
    stop: async () => {},
    send: async () => {},
  }
  return { name, manifest: { name, septum: '^0.11', kind: 'hypha', capabilities: [] }, instance, config: undefined }
}

function listenThrowingHypha(name: string, detail: string): GerminatedHypha {
  const instance: Hypha = {
    connect: async () => {},
    listen: () => { throw new Error(detail) },
    stop: async () => {},
    send: async () => {},
  }
  return { name, manifest: { name, septum: '^0.11', kind: 'hypha', capabilities: [] }, instance, config: undefined }
}

function startThrowingRhiza(name: string, detail: string): GerminatedRhiza {
  const instance: Rhiza = {
    start: async () => { throw new Error(detail) },
    stop: async () => {},
    health: async () => ({ state: 'healthy', checkedAt: new Date() }),
    api: {},
  }
  return { name, manifest: { name, septum: '^0.11', kind: 'rhiza' }, instance, config: undefined }
}

function startThrowingEnzyme(name: string, detail: string): GerminatedEnzyme {
  const instance: Enzyme = {
    handlers: {},
    start: async () => { throw new Error(detail) },
    stop: async () => {},
  }
  return {
    name,
    manifest: {
      name, septum: '^0.11', kind: 'enzyme',
      commands: [{ name: 'x', description: 'x', respond: 'x' }],
    },
    instance,
    resolved: new Set(),
    scopes: [],
    config: undefined,
  }
}

function startThrowingInhibitor(name: string, detail: string, enforcing: boolean): GerminatedInhibitor {
  const instance: Inhibitor = {
    inspect: async () => ({ allow: true }),
    start: async () => { throw new Error(detail) },
  }
  return {
    name, config: {}, resolved: new Set(), scopes: [],
    manifest: { kind: 'inhibitor', name, septum: '^0.11', enforcing },
    instance,
  } as unknown as GerminatedInhibitor
}

describe('startMycelium dormancy refusals', () => {
  it('carries a startup refusal ref for a hypha whose connect() throws', async () => {
    const { db } = freshDb()
    const registry: Registry = { ...emptyRegistry(), hyphae: [connectThrowingHypha('thrower', 'no network')] }
    const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
    const dormant = started.registry.dormant.find((d) => d.name === 'thrower')
    expect(dormant?.refusal).toEqual({
      domain: SHARED_DOMAIN, key: 'refusal.startup.hyphaConnectFailed',
      params: { detail: 'no network' },
    })
  })

  // One key for three kinds, because the three sentences are byte-identical and the kind is
  // already beside the reason on every surface (plan correction 1).
  it('shares one startFailed key across the rhiza, enzyme and inhibitor sites', async () => {
    {
      const { db } = freshDb()
      const rhiza = startThrowingRhiza('r1', 'rhiza boom')
      const registry: Registry = { ...emptyRegistry(), rhizas: [rhiza], order: ['r1'] }
      const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
      expect(started.registry.dormant[0]?.refusal).toEqual({
        domain: SHARED_DOMAIN, key: 'refusal.startup.startFailed', params: { detail: 'rhiza boom' },
      })
    }
    {
      const { db } = freshDb()
      const enzyme = startThrowingEnzyme('e1', 'enzyme boom')
      const registry: Registry = { ...emptyRegistry(), enzymes: [enzyme], order: ['e1'] }
      const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
      expect(started.registry.dormant[0]?.refusal).toEqual({
        domain: SHARED_DOMAIN, key: 'refusal.startup.startFailed', params: { detail: 'enzyme boom' },
      })
    }
    {
      const { db } = freshDb()
      const inhibitor = startThrowingInhibitor('i1', 'inhibitor boom', false)
      const registry: Registry = { ...emptyRegistry(), inhibitors: [inhibitor] }
      const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
      expect(started.registry.dormant[0]?.refusal).toEqual({
        domain: SHARED_DOMAIN, key: 'refusal.startup.startFailed', params: { detail: 'inhibitor boom' },
      })
    }
  })

  it('distinguishes a listen() failure from a connect() failure', async () => {
    const { db } = freshDb()
    const registry: Registry = { ...emptyRegistry(), hyphae: [listenThrowingHypha('h1', 'listen boom')] }
    const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
    expect(started.registry.dormant[0]?.refusal).toEqual({
      domain: SHARED_DOMAIN, key: 'refusal.startup.hyphaListenFailed', params: { detail: 'listen boom' },
    })
  })

  // The enforcing inhibitor keeps refusing all traffic, and the ref must not change that:
  // design §7 is about brokenEnforcing, not about the sentence.
  it('still lists a broken enforcing inhibitor in brokenEnforcing', async () => {
    const { db } = freshDb()
    const inhibitor = startThrowingInhibitor('gate', 'gate boom', true)
    const registry: Registry = { ...emptyRegistry(), inhibitors: [inhibitor] }
    const started = await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
    expect(started.registry.brokenEnforcing).toContain('gate')
    expect(started.registry.dormant[0]?.refusal).toEqual({
      domain: SHARED_DOMAIN, key: 'refusal.startup.startFailed', params: { detail: 'gate boom' },
    })
  })
})
