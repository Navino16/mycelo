import type { Enzyme, Hypha, Rhiza } from '@mycelo/septum'
import { describe, expect, it } from 'bun:test'
import type { GerminatedEnzyme, GerminatedHypha, GerminatedRhiza, Registry } from '../../src/germination/registry.js'
import { stopMycelium } from '../../src/boot/start.js'
import type { Mycelium } from '../../src/boot/start.js'
import { createLogger } from '../../src/support/logger.js'

function myceliumWith(overrides: {
  hyphae?: readonly GerminatedHypha[]
  /** Defaults to `hyphae`; set separately to simulate a hypha demoted after connect(). */
  connectedHyphae?: readonly GerminatedHypha[]
  rhizas?: readonly GerminatedRhiza[]
  enzymes?: readonly GerminatedEnzyme[]
}): Mycelium {
  const rhizas = overrides.rhizas ?? []
  const enzymes = overrides.enzymes ?? []
  const hyphae = overrides.hyphae ?? []
  const registry: Registry = {
    hyphae,
    enzymes,
    rhizas,
    inhibitors: [],
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
    manifest: { name, septum: '^0.7', kind: 'hypha', capabilities: [] },
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

function stubRhiza(name: string, stopped: string[]): GerminatedRhiza {
  const instance: Rhiza = {
    start: async () => {},
    stop: async () => { stopped.push(name) },
    health: async () => ({ state: 'healthy', checkedAt: new Date() }),
    api: {},
  }
  return {
    name,
    manifest: { name, septum: '^0.7', kind: 'rhiza' },
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
      name, septum: '^0.7', kind: 'enzyme',
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
