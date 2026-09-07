import { expect, it } from 'bun:test'
import { fault } from '../../src/germination/fault.js'
import { SHARED_DOMAIN } from '../../src/i18n/core-catalogs.js'

it('carries the sentence and a ref in the shared domain', () => {
  const f = fault('create() returned no inspect()', 'refusal.germination.inhibitorNoInspect')
  expect(f.message).toBe('create() returned no inspect()')
  expect(f.refusal).toEqual({
    domain: SHARED_DOMAIN, key: 'refusal.germination.inhibitorNoInspect',
  })
})

// An empty `params` on the ref is not the same value as an absent one: `render` branches on
// `params == null`, and every existing ref assertion in this repo is written with toEqual.
it('omits params entirely when none are given', () => {
  expect('params' in fault('x', 'k').refusal).toBe(false)
})

it('carries params through untouched, including a nested ref', () => {
  const cause = { domain: SHARED_DOMAIN, key: 'refusal.germination.rhizaNoApi' }
  const f = fault('requires rhiza \'r\', which is dormant: x', 'refusal.germination.dependencyDormant', { rhiza: 'r', cause })
  expect(f.refusal.params).toEqual({ rhiza: 'r', cause })
})
