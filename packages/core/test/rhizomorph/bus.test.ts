import { expect, it, vi } from 'vitest'
import type { Enzyme, Hypha, IncomingMessage, Logger, OutgoingContent } from '@mycelo/septum'
import { buildRoutes } from '../../src/germination/registry.js'
import type { GerminatedEnzyme, GerminatedHypha, Registry } from '../../src/germination/registry.js'
import { createBus } from '../../src/rhizomorph/bus.js'
import { createLogger } from '../../src/support/logger.js'

function setup(enzyme: Enzyme): { registry: Registry; sent: OutgoingContent[] } {
  const sent: OutgoingContent[] = []
  const hypha: Hypha = {
    async start() {}, async stop() {},
    async send(_c, out) { sent.push(out) },
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: ['reactions'] },
    instance: hypha,
  }]
  const enzymes: GerminatedEnzyme[] = [{
    name: 'ping',
    manifest: {
      kind: 'enzyme', name: 'ping', septum: '^1.0',
      commands: [{ name: 'ping', description: 'Health check' }],
    },
    instance: enzyme,
  }]
  return { registry: { hyphae, enzymes, dormant: [], routes: buildRoutes(enzymes) }, sent }
}

function message(text: string): IncomingMessage {
  return {
    channel: 'console', conversationId: 'c:1', messageId: 'm:1',
    sender: { channel: 'console', externalId: 'local' },
    text, attachments: [], raw: null, receivedAt: new Date(0),
  }
}

it('routes a command to its enzyme and the reply back to the channel', async () => {
  const { registry, sent } = setup({
    async handle(_inv, ctx) { await ctx.reply({ text: 'pong' }) },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(sent).toEqual([{ text: 'pong' }])
})

it('reports an unknown command without invoking anything', async () => {
  const handle = vi.fn()
  const { registry } = setup({ handle })
  const onUnrouted = vi.fn(async () => {})
  const bus = createBus({ registry, prefix: '/', logger: createLogger(), onUnrouted })
  await bus.deliver('console', message('/nope'))
  expect(handle).not.toHaveBeenCalled()
  expect(onUnrouted).toHaveBeenCalledWith(expect.anything(), 'nope')
})

it('ignores text carrying no command', async () => {
  const handle = vi.fn()
  const { registry } = setup({ handle })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('just talking'))
  expect(handle).not.toHaveBeenCalled()
})

it('contains a handler that throws and answers on the channel', async () => {
  const { registry, sent } = setup({
    async handle() { throw new Error('boom') },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(sent[0]?.text).toContain('failed')
})

it('exposes the channel capabilities to the enzyme', async () => {
  let reported: readonly string[] = []
  const { registry } = setup({
    async handle(_inv, ctx) { reported = ctx.capabilities.list() },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(reported).toEqual(['reactions'])
})

it('throws a message naming the phase for a facility that does not exist yet', async () => {
  let caught = ''
  const { registry } = setup({
    async handle(_inv, ctx) {
      try { ctx.rhiza('radarr') } catch (e) { caught = (e as Error).message }
    },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).toContain('phase 3')
})

it('throws a message naming the phase for ctx.on()', async () => {
  let caught = ''
  const { registry } = setup({
    async handle(_inv, ctx) {
      try { ctx.on('radarr', 'released', () => {}) } catch (e) { caught = (e as Error).message }
    },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).toContain('phase 3')
})

it('throws a message naming the phase for ctx.principal', async () => {
  let caught = ''
  const { registry } = setup({
    async handle(_inv, ctx) {
      try { void ctx.principal } catch (e) { caught = (e as Error).message }
    },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(caught).toContain('phase 4')
})

it('never lets ctx.has() claim a dependency resolved: nothing has requires yet', async () => {
  let result = true
  const { registry } = setup({
    async handle(_inv, ctx) { result = ctx.has('radarr') },
  })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  await bus.deliver('console', message('/ping'))
  expect(result).toBe(false)
})

it('contains a malformed message instead of rejecting the fire-and-forget deliver()', async () => {
  const handle = vi.fn()
  const { registry } = setup({ handle })
  const bus = createBus({ registry, prefix: '/', logger: createLogger() })
  const malformed = { ...message('/ping'), conversationId: '' }
  await expect(bus.deliver('console', malformed)).resolves.toBeUndefined()
  expect(handle).not.toHaveBeenCalled()
})

it('contains an onUnrouted callback that itself throws', async () => {
  const { registry } = setup({ async handle() {} })
  const onUnrouted = vi.fn(async () => { throw new Error('onUnrouted exploded') })
  const bus = createBus({ registry, prefix: '/', logger: createLogger(), onUnrouted })
  await expect(bus.deliver('console', message('/nope'))).resolves.toBeUndefined()
  expect(onUnrouted).toHaveBeenCalled()
})

it('contains a recovery send that also fails, with nowhere left to answer', async () => {
  const hypha: Hypha = {
    async start() {}, async stop() {},
    async send() { throw new Error('channel down') },
  }
  const hyphae: GerminatedHypha[] = [{
    name: 'console',
    manifest: { kind: 'hypha', name: 'console', septum: '^1.0', capabilities: [] },
    instance: hypha,
  }]
  const enzymes: GerminatedEnzyme[] = [{
    name: 'ping',
    manifest: {
      kind: 'enzyme', name: 'ping', septum: '^1.0',
      commands: [{ name: 'ping', description: 'Health check' }],
    },
    instance: { async handle() { throw new Error('boom') } },
  }]
  const registry: Registry = { hyphae, enzymes, dormant: [], routes: buildRoutes(enzymes) }
  // A bespoke logger, not createLogger(): distinguishes "contained by the specific
  // recovery-send try" from "contained by the outer catch-all" — both would make the
  // promise resolve, but only the former logs both failures under their own messages.
  const errors: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, warn() {},
    error: (m) => { errors.push(m) },
    child: () => logger,
  }
  const bus = createBus({ registry, prefix: '/', logger })
  await expect(bus.deliver('console', message('/ping'))).resolves.toBeUndefined()
  expect(errors).toHaveLength(2)
  expect(errors[1]).toContain('could not report')
})
