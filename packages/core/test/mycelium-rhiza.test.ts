import { expect, it } from 'bun:test'
import type { HealthRead, PluginsRead } from '@mycelo/septum'
import type { Registry } from '../src/germination/registry.js'
import { createMyceliumApi } from '../src/mycelium-rhiza.js'

const stubSend = async () => {}
const registry = {
  hyphae: [], rhizas: [], dormant: [{ name: 'broken', reason: 'create() returned no api' }],
  enzymes: [{ name: 'media', manifest: { kind: 'enzyme', name: 'media', septum: '^0.4',
    commands: [{ name: 'movies', description: 'x', code: 'h' }] }, instance: null }],
  routes: new Map(),
} as unknown as Registry

it('mounts only what the scopes grant', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend)
  expect(typeof (api as PluginsRead).listPlugins).toBe('function')
  expect('send' in api).toBe(false)
  expect('health' in api).toBe(false)
})

it('does not mount listPlugins when plugins.read is not granted', () => {
  expect('listPlugins' in createMyceliumApi(registry, ['health.read'], stubSend)).toBe(false)
})

it('lists germinated and dormant plugins with their reasons', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend) as PluginsRead
  expect(api.listPlugins()).toEqual([
    { name: 'media', kind: 'enzyme', commands: ['movies'], state: 'germinated' },
    { name: 'broken', commands: [], state: 'dormant', reason: 'create() returned no api' },
  ])
})

it('omits kind for a dormant plugin rather than inventing one, since none was ever known', () => {
  const api = createMyceliumApi(registry, ['plugins.read'], stubSend) as PluginsRead
  const broken = api.listPlugins().find((p) => p.name === 'broken')
  expect(broken).toBeDefined()
  expect(broken).not.toHaveProperty('kind')
})

it('aggregates each germinated rhiza health', async () => {
  const checkedAt = new Date(0)
  const withRhiza = { ...registry, rhizas: [{ name: 'mock', manifest: {},
    instance: { health: async () => ({ state: 'healthy', checkedAt }) } }] } as unknown as Registry
  const api = createMyceliumApi(withRhiza, ['health.read'], stubSend) as HealthRead
  expect(await api.health()).toEqual([{ rhiza: 'mock', status: { state: 'healthy', checkedAt } }])
})
