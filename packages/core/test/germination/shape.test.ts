import { expect, it } from 'bun:test'
import type { CommandSpec, Enzyme, HyphaManifest } from '@mycelo/septum'
import { loadCoreCatalogs, SHARED_DOMAIN } from '../../src/i18n/core-catalogs.js'
import { renderRefusal } from '../../src/i18n/refusal.js'
import { createTranslator } from '../../src/i18n/translator.js'
import {
  capabilityShapeError,
  enzymeShapeError,
  hyphaShapeError,
  inhibitorShapeError,
  rhizaShapeError,
  unreferencedHandlers,
} from '../../src/germination/shape.js'

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }
const translator = createTranslator({ defaultLocale: 'en', logger: silent, catalogs: loadCoreCatalogs() })

const respond = (name: string): CommandSpec => ({ name, description: name, respond: name })
const code = (name: string, handler = name): CommandSpec => ({ name, description: name, code: handler })

function manifest(capabilities: HyphaManifest['capabilities']): HyphaManifest {
  return { kind: 'hypha', name: 'test', septum: '^1.0', capabilities }
}

it('hyphaShapeError refuses a non-object instance', () => {
  expect(hyphaShapeError(null, 'hypha')?.key).toBe('refusal.germination.createNotObject')
  expect(hyphaShapeError('nope', 'hypha')?.key).toBe('refusal.germination.createNotObject')
})

it('hyphaShapeError names every missing method', () => {
  const f = hyphaShapeError({}, 'hypha')
  expect(f?.key).toBe('refusal.germination.createMissingMethods')
  expect(f?.params).toEqual({ missing: 'connect, listen, stop, send' })
})

it('hyphaShapeError accepts an instance with all four methods', () => {
  const instance = { connect: async () => {}, listen: () => {}, stop: async () => {}, send: async () => {} }
  expect(hyphaShapeError(instance, 'hypha')).toBeNull()
})

it('capabilityShapeError refuses a declared capability with no matching method', () => {
  expect(capabilityShapeError({}, manifest(['group_membership']))?.key)
    .toBe('refusal.germination.capabilityUnimplemented')
})

it('capabilityShapeError refuses an implemented method with no declared capability', () => {
  const instance = { listGroupMembers: async () => [] }
  expect(capabilityShapeError(instance, manifest([]))?.key)
    .toBe('refusal.germination.capabilityUndeclared')
})

it('capabilityShapeError accepts a capability and its method declared together', () => {
  const instance = { listGroupMembers: async () => [] }
  expect(capabilityShapeError(instance, manifest(['group_membership']))).toBeNull()
})

it('capabilityShapeError accepts neither declared nor implemented', () => {
  expect(capabilityShapeError({}, manifest([]))).toBeNull()
})

it('enzymeShapeError refuses a non-object instance', () => {
  expect(enzymeShapeError(null, [])?.key).toBe('refusal.germination.createNotObject')
})

it('enzymeShapeError refuses an instance with no handlers object', () => {
  expect(enzymeShapeError({}, [code('go')])?.key).toBe('refusal.germination.enzymeNoHandlersObject')
})

it('enzymeShapeError names a command whose handler is missing', () => {
  const f = enzymeShapeError({ handlers: {} }, [code('go', 'handleGo')])
  expect(f?.key).toBe('refusal.germination.handlersMissing')
  expect(f?.params).toEqual({ missing: 'handleGo' })
})

it('enzymeShapeError ignores respond: commands, which need no handler', () => {
  expect(enzymeShapeError({ handlers: {} }, [respond('go')])).toBeNull()
})

it('enzymeShapeError refuses start() with no stop()', () => {
  const instance = { handlers: { go: async () => {} }, start: async () => {} }
  expect(enzymeShapeError(instance, [code('go')])?.key).toBe('refusal.germination.startStopMismatch')
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
  expect(rhizaShapeError(null)?.key).toBe('refusal.germination.createNotObject')
})

it('rhizaShapeError names every missing method', () => {
  const f = rhizaShapeError({})
  expect(f?.key).toBe('refusal.germination.createMissingMethods')
  expect(f?.params).toEqual({ missing: 'start, stop, health' })
})

it('rhizaShapeError refuses an instance with no api', () => {
  const instance = { start: async () => {}, stop: async () => {}, health: async () => 'healthy' }
  expect(rhizaShapeError(instance)?.key).toBe('refusal.germination.rhizaNoApi')
})

it('rhizaShapeError accepts a fully-shaped instance', () => {
  const instance = { start: async () => {}, stop: async () => {}, health: async () => 'healthy', api: {} }
  expect(rhizaShapeError(instance)).toBeNull()
})

it('names every missing rhiza method, not only the first', () => {
  const f = rhizaShapeError({ start: () => {} })
  expect(f?.key).toBe('refusal.germination.createMissingMethods')
  expect(f?.params).toEqual({ missing: 'stop, health' })
})

it('names every missing handler, not only the first', () => {
  const f = enzymeShapeError({ handlers: {} }, [code('go'), code('stop')])
  expect(f?.key).toBe('refusal.germination.handlersMissing')
  expect(f?.params).toEqual({ missing: 'go, stop' })
})

it('reports a non-object create() with what it actually returned', () => {
  expect(rhizaShapeError(null)).toEqual({
    domain: SHARED_DOMAIN, key: 'refusal.germination.createNotObject', params: { got: 'null' },
  })
  expect(hyphaShapeError(42, 'hypha')?.params).toEqual({ got: '42' })
  expect(enzymeShapeError(undefined, [])?.params).toEqual({ got: 'undefined' })
  expect(inhibitorShapeError('x')?.params).toEqual({ got: 'x' })
})

it('distinguishes the two group_membership directions', () => {
  expect(capabilityShapeError({}, manifest(['group_membership']))?.key)
    .toBe('refusal.germination.capabilityUnimplemented')
  expect(capabilityShapeError({ listGroupMembers: () => [] }, manifest([]))?.key)
    .toBe('refusal.germination.capabilityUndeclared')
})

it('names the uncallable method rather than reporting a generic mismatch', () => {
  const f = inhibitorShapeError({ inspect: () => {}, start: 'no', stop: 'no' })
  expect(f?.key).toBe('refusal.germination.methodNotCallable')
  expect(f?.params).toEqual({ method: 'start' })
})

it('inhibitorShapeError refuses an instance with no inspect()', () => {
  expect(inhibitorShapeError({})?.key).toBe('refusal.germination.inhibitorNoInspect')
})

it('inhibitorShapeError refuses start() with no stop()', () => {
  const instance = { inspect: () => {}, start: async () => {} }
  expect(inhibitorShapeError(instance)?.key).toBe('refusal.germination.startStopMismatch')
})

it('inhibitorShapeError accepts a fully-shaped instance', () => {
  const instance = { inspect: () => {}, start: async () => {}, stop: async () => {} }
  expect(inhibitorShapeError(instance)).toBeNull()
})

// The sentence moved into the catalogue, so this is what still holds it to the wording an
// operator read before the migration — the ref alone would let the English drift silently.
it('renders the same English sentence the shape error used to author itself', () => {
  const refusal = rhizaShapeError({ start: () => {} })
  expect(refusal).not.toBeNull()
  expect(refusal === null ? '' : renderRefusal(translator, refusal, 'en'))
    .toBe('create() returned no stop, health')
  const instance = { start: async () => {}, stop: async () => {}, health: async () => 'healthy' }
  const noApi = rhizaShapeError(instance)
  expect(noApi).not.toBeNull()
  expect(noApi === null ? '' : renderRefusal(translator, noApi, 'en'))
    .toBe('create() returned no api — enzymes would resolve undefined through ctx.rhiza()')
})
