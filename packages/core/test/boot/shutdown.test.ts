import type { Enzyme, Hypha, Rhiza } from '@mycelo/septum'
import { describe, expect, it } from 'bun:test'
import type { GerminatedEnzyme, GerminatedHypha, GerminatedInhibitor, GerminatedRhiza, Registry } from '../../src/germination/registry.js'
import { startMycelium, stopMycelium } from '../../src/boot/start.js'
import type { Mycelium } from '../../src/boot/start.js'
import type { RuntimeState } from '../../src/boot/state.js'
import { createLogger } from '../../src/support/logger.js'

function myceliumWith(overrides: {
  hyphae?: readonly GerminatedHypha[]
  /** Defaults to `hyphae`; set separately to simulate a hypha demoted after connect(). */
  connectedHyphae?: readonly GerminatedHypha[]
  rhizas?: readonly GerminatedRhiza[]
  enzymes?: readonly GerminatedEnzyme[]
  inhibitors?: readonly GerminatedInhibitor[]
}): Mycelium {
  const rhizas = overrides.rhizas ?? []
  const enzymes = overrides.enzymes ?? []
  const hyphae = overrides.hyphae ?? []
  const registry: Registry = {
    hyphae,
    enzymes,
    rhizas,
    inhibitors: overrides.inhibitors ?? [],
    dormant: [],
    routes: new Map(),
    order: [...rhizas, ...enzymes].map((s) => s.name),
    brokenEnforcing: [],
    catalogs: new Map(),
  }
  return {
    registry,
    connectedHyphae: overrides.connectedHyphae ?? hyphae,
    bus: { deliver: async () => {} },
    admission: { admit: async () => ({ allow: true }) },
  }
}

function hypha(name: string, stop: () => Promise<void>): GerminatedHypha {
  const instance: Hypha = {
    connect: async () => {},
    listen: () => {},
    stop,
    send: async () => {},
  }
  return {
    name,
    manifest: { name, septum: '^0.10', kind: 'hypha', capabilities: [] },
    instance,
    config: undefined,
  }
}

function stubHypha(name: string, stopped: string[]): GerminatedHypha {
  return hypha(name, async () => { stopped.push(name) })
}

function throwingHypha(name: string): GerminatedHypha {
  return hypha(name, async () => { throw new Error('stop failed') })
}

// Inhibitor.stop is optional in the contract, so a stub carrying one is the only way to
// prove the loop that calls it exists at all.
function stubInhibitor(name: string, stopped: string[]): GerminatedInhibitor {
  return {
    name, config: {}, resolved: new Set(), scopes: [],
    manifest: { kind: 'inhibitor', name, septum: '^0.10', enforcing: false },
    instance: { inspect: async () => ({ allow: true }), stop: async () => { stopped.push(name) } },
  } as unknown as GerminatedInhibitor
}

function stubRhiza(name: string, stopped: string[]): GerminatedRhiza {
  const instance: Rhiza = {
    start: async () => {},
    stop: async () => { stopped.push(name) },
    health: async () => ({ state: 'healthy', checkedAt: new Date() }),
    api: {},
  }
  return {
    name,
    manifest: { name, septum: '^0.10', kind: 'rhiza' },
    instance,
    config: undefined,
  }
}

function stubEnzyme(name: string, stopped: string[]): GerminatedEnzyme {
  const instance: Enzyme = {
    handlers: {},
    stop: async () => { stopped.push(name) },
  }
  return {
    name,
    manifest: {
      name, septum: '^0.10', kind: 'enzyme',
      commands: [{ name: 'x', description: 'x', respond: 'x' }],
    },
    instance,
    resolved: new Set(),
    scopes: [],
    config: undefined,
  }
}

describe('stopMycelium', () => {
  it('stops every germinated spore, not just the last', async () => {
    const stopped: string[] = []
    const mycelium = myceliumWith({
      hyphae: [stubHypha('a', stopped), stubHypha('b', stopped)],
      rhizas: [stubRhiza('r1', stopped), stubRhiza('r2', stopped)],
      enzymes: [stubEnzyme('e1', stopped), stubEnzyme('e2', stopped)],
    })
    expect(await stopMycelium(mycelium, createLogger())).toEqual([])
    // The plural case. Phase 5.5's mutation campaign found a set collapsed to its last
    // element surviving a whole suite built on single-element fixtures.
    expect(stopped.sort()).toEqual(['a', 'b', 'e1', 'e2', 'r1', 'r2'])
  })

  it('stops inbound channels before the spores that answer on them', async () => {
    const order: string[] = []
    const mycelium = myceliumWith({
      hyphae: [stubHypha('chan', order)],
      enzymes: [stubEnzyme('enz', order)],
    })
    await stopMycelium(mycelium, createLogger())
    // A channel still accepting messages after its enzyme stopped would dispatch into a
    // stopped plugin. Inbound closes first.
    expect(order.indexOf('chan')).toBeLessThan(order.indexOf('enz'))
  })

  it('keeps stopping after one spore throws, and reports which failed', async () => {
    const stopped: string[] = []
    const mycelium = myceliumWith({
      hyphae: [throwingHypha('bad'), stubHypha('good', stopped)],
    })
    const failures = await stopMycelium(mycelium, createLogger())
    // One plugin must not be able to hold the process open or strand its siblings.
    expect(stopped).toEqual(['good'])
    expect(failures).toEqual([{ name: 'bad', error: 'stop failed' }])
  })

  // Every fixture in this file set `inhibitors: []` until now, so deleting the inhibitor
  // stop loop survived the whole suite.
  it('stops every inhibitor, after the channels and before the rhizas', async () => {
    const order: string[] = []
    const mycelium = myceliumWith({
      hyphae: [stubHypha('chan', order)],
      rhizas: [stubRhiza('r1', order)],
      inhibitors: [stubInhibitor('gate', order), stubInhibitor('guard', order)],
    })
    await stopMycelium(mycelium, createLogger())
    // The plural case, and the position: an inhibitor may call into a rhiza (design §7),
    // so it stops while that rhiza is still running.
    expect(order).toEqual(['chan', 'gate', 'guard', 'r1'])
  })

  // The invariant stated at start.ts's reverse loop — "a rhiza must outlive the enzymes that
  // call into it" — had no test: the ordering test above it only pins hypha before enzyme.
  it('stops an enzyme before the rhiza it calls into', async () => {
    const order: string[] = []
    const mycelium = myceliumWith({
      rhizas: [stubRhiza('conn', order)],
      enzymes: [stubEnzyme('caller', order)],
    })
    await stopMycelium(mycelium, createLogger())
    // registry.order is dependency-first (conn, then caller), so stopping walks it reversed.
    expect(order).toEqual(['caller', 'conn'])
  })

  it('stops a hypha whose listen() failed although registry.hyphae excludes it', async () => {
    const stopped: string[] = []
    const flaky = stubHypha('flaky', stopped)
    // listPlugins()/registry.hyphae report only the listening set (start.ts step 3), but
    // the connection itself is live and must still be torn down.
    const mycelium = myceliumWith({ hyphae: [], connectedHyphae: [flaky] })
    expect(await stopMycelium(mycelium, createLogger())).toEqual([])
    expect(stopped).toEqual(['flaky'])
  })

  it('does not reject when a spore rejects', () => {
    const mycelium = myceliumWith({ hyphae: [throwingHypha('bad')] })
    // Bare, not awaited: `await expect(...).resolves` trips @typescript-eslint/await-thenable
    // here, same as the `.rejects` case CLAUDE.md already records; Bun still fails it correctly.
    expect(stopMycelium(mycelium, createLogger())).resolves.toBeDefined()
  })
})

describe('startMycelium', () => {
  // A registry.order naming a spore that is neither rhiza nor enzyme reaches start.ts's
  // `unreachable` throw — the one reachable door past the connect loop (review, Important 4).
  it('stops what it started when the dependency walk throws, and still propagates', async () => {
    const stopped: string[] = []
    const registry: Registry = {
      hyphae: [stubHypha('chan', stopped)],
      enzymes: [],
      rhizas: [stubRhiza('r1', stopped)],
      inhibitors: [],
      dormant: [],
      routes: new Map(),
      order: ['r1', 'ghost'],
      brokenEnforcing: [],
      catalogs: new Map(),
    }
    const state = {
      config: { sporesDirs: ['/none'], prefix: '/', defaultLocale: 'en' },
      db: {},
      translator: {},
    } as unknown as RuntimeState
    const started = startMycelium({ registry, state, logger: createLogger() })
    // Bare, not awaited: `await expect(...).rejects` trips @typescript-eslint/await-thenable.
    expect(started).rejects.toThrow(/neither a rhiza nor an enzyme/)
    await started.catch(() => { /* asserted above; this only sequences the check below */ })
    // spec §4.2 rests on degraded mode meaning nothing is connected: the hypha this call
    // connected and the rhiza it started are both torn down before the fault escapes.
    expect(stopped).toEqual(['chan', 'r1'])
  })
})
