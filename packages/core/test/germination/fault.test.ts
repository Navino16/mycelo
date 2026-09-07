import { expect, it } from 'bun:test'
import { dormancyRefusal } from '../../src/germination/fault.js'
import { SHARED_DOMAIN } from '../../src/i18n/core-catalogs.js'

it('builds a ref in the shared domain', () => {
  expect(dormancyRefusal('refusal.germination.inhibitorNoInspect')).toEqual({
    domain: SHARED_DOMAIN, key: 'refusal.germination.inhibitorNoInspect',
  })
})

// An empty `params` is not the same value as an absent one: `render` branches on
// `params == null`, and every existing ref assertion in this repo is written with toEqual.
it('omits params entirely when the key takes none', () => {
  expect('params' in dormancyRefusal('refusal.germination.startStopMismatch')).toBe(false)
})

it('carries params through untouched, including a nested ref', () => {
  const cause = { domain: SHARED_DOMAIN, key: 'refusal.germination.rhizaNoApi' }
  const refusal = dormancyRefusal('refusal.germination.dependencyDormant', { rhiza: 'r', cause })
  expect(refusal.params).toEqual({ rhiza: 'r', cause })
})
