import { expect, it } from 'bun:test'
import type { CommandSpec, Enzyme, HyphaManifest } from '@mycelo/septum'
import {
  capabilityShapeError,
  enzymeShapeError,
  hyphaShapeError,
  rhizaShapeError,
  unreferencedHandlers,
} from '../../src/germination/shape.js'

const respond = (name: string): CommandSpec => ({ name, description: name, respond: name })
const code = (name: string, handler = name): CommandSpec => ({ name, description: name, code: handler })

function manifest(capabilities: HyphaManifest['capabilities']): HyphaManifest {
  return { kind: 'hypha', name: 'test', septum: '^0.11', capabilities }
}

it('hyphaShapeError refuses a non-object instance', () => {
  expect(hyphaShapeError(null, 'hypha')).toContain('expected an object')
  expect(hyphaShapeError('nope', 'hypha')).toContain('expected an object')
})

it('hyphaShapeError names every missing method', () => {
  expect(hyphaShapeError({}, 'hypha')).toBe('create() returned no connect, listen, stop, send')
})

it('hyphaShapeError accepts an instance with all four methods', () => {
  const instance = { connect: async () => {}, listen: () => {}, stop: async () => {}, send: async () => {} }
  expect(hyphaShapeError(instance, 'hypha')).toBeNull()
})

it('capabilityShapeError refuses a declared capability with no matching method', () => {
  expect(capabilityShapeError({}, manifest(['group_membership']))).toContain('no listGroupMembers()')
})

it('capabilityShapeError refuses an implemented method with no declared capability', () => {
  const instance = { listGroupMembers: async () => [] }
  expect(capabilityShapeError(instance, manifest([]))).toContain('does not declare group_membership')
})

it('capabilityShapeError accepts a capability and its method declared together', () => {
  const instance = { listGroupMembers: async () => [] }
  expect(capabilityShapeError(instance, manifest(['group_membership']))).toBeNull()
})

it('capabilityShapeError accepts neither declared nor implemented', () => {
  expect(capabilityShapeError({}, manifest([]))).toBeNull()
})

it('enzymeShapeError refuses a non-object instance', () => {
  expect(enzymeShapeError(null, [])).toContain('expected an object')
})

it('enzymeShapeError refuses an instance with no handlers object', () => {
  expect(enzymeShapeError({}, [code('go')])).toBe('create() returned no handlers object')
})

it('enzymeShapeError names a command whose handler is missing', () => {
  expect(enzymeShapeError({ handlers: {} }, [code('go', 'handleGo')])).toBe('handlers has no function for: handleGo')
})

it('enzymeShapeError ignores respond: commands, which need no handler', () => {
  expect(enzymeShapeError({ handlers: {} }, [respond('go')])).toBeNull()
})

it('enzymeShapeError refuses start() with no stop()', () => {
  const instance = { handlers: { go: async () => {} }, start: async () => {} }
  expect(enzymeShapeError(instance, [code('go')])).toBe('start() and stop() must be both present or both absent')
})

it('enzymeShapeError accepts start() and stop() paired', () => {
  const instance = { handlers: { go: async () => {} }, start: async () => {}, stop: async () => {} }
  expect(enzymeShapeError(instance, [code('go')])).toBeNull()
})

it('unreferencedHandlers names a handler no command references', () => {
  const instance: Enzyme = { handlers: { go: async () => {}, leftover: async () => {} } }
  expect(unreferencedHandlers(instance, [code('a', 'go')])).toEqual(['leftover'])
})

it('unreferencedHandlers names nothing when every handler is referenced', () => {
  const instance: Enzyme = { handlers: { go: async () => {} } }
  expect(unreferencedHandlers(instance, [code('a', 'go')])).toEqual([])
})

it('rhizaShapeError refuses a non-object instance', () => {
  expect(rhizaShapeError(null)).toContain('expected an object')
})

it('rhizaShapeError names every missing method', () => {
  expect(rhizaShapeError({})).toBe('create() returned no start, stop, health')
})

it('rhizaShapeError refuses an instance with no api', () => {
  const instance = { start: async () => {}, stop: async () => {}, health: async () => 'healthy' }
  expect(rhizaShapeError(instance)).toContain('no api')
})

it('rhizaShapeError accepts a fully-shaped instance', () => {
  const instance = { start: async () => {}, stop: async () => {}, health: async () => 'healthy', api: {} }
  expect(rhizaShapeError(instance)).toBeNull()
})
