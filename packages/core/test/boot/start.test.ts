import { describe, expect, it } from 'bun:test'
import type { Hypha } from '@mycelo/septum'
import { startMycelium } from '../../src/boot/start.js'
import type { RuntimeState } from '../../src/boot/state.js'
import type { GerminatedHypha, Registry } from '../../src/germination/registry.js'
import { freshDb } from '../support/db.js'
import { silentLogger } from '../support/logger.js'
import { emptyRegistry } from '../support/registry.js'

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

/** Not named 'probe': a literal 'probe' passed as ctx.name would pass this fixture too. */
function nameCapturingHypha(manifestName: string, capture: { name?: string }): GerminatedHypha {
  const instance: Hypha = {
    connect: async (ctx) => { capture.name = ctx.name },
    listen: () => {},
    stop: async () => {},
    send: async () => {},
  }
  return {
    name: manifestName,
    manifest: { name: manifestName, septum: '^0.12', kind: 'hypha', capabilities: [] },
    instance,
    config: undefined,
  }
}

describe('startMycelium hypha context', () => {
  it("hands connect() the hypha's own manifest name", async () => {
    const { db } = freshDb()
    const capture: { name?: string } = {}
    const registry: Registry = { ...emptyRegistry(), hyphae: [nameCapturingHypha('signal-bridge', capture)] }
    await startMycelium({ registry, state: stateWith(db), logger: silentLogger() })
    expect(capture.name).toBe('signal-bridge')
  })
})
