import { expect, it } from 'bun:test'
import type { Enzyme } from '@mycelo/septum'
import { buildRoutes, CollisionError } from '../../src/germination/registry.js'
import type { GerminatedEnzyme } from '../../src/germination/registry.js'

const instance: Enzyme = { handlers: {} }

function enzyme(name: string, commands: string[]): GerminatedEnzyme {
  return {
    name,
    manifest: {
      kind: 'enzyme', name, septum: '^0.11',
      commands: commands.map((c) => ({ name: c, description: c, code: c })),
    },
    instance,
    resolved: new Set(),
    scopes: [],
    config: {},
  }
}

it('indexes commands by short name and records the qualified form', () => {
  const routes = buildRoutes([enzyme('radarr', ['upcoming'])], new Map())
  expect(routes.get('upcoming')?.qualified).toBe('radarr.upcoming')
})

it('halts on a command declared by two plugins', () => {
  expect(() => buildRoutes([enzyme('a', ['status']), enzyme('b', ['status'])], new Map()))
    .toThrow(CollisionError)
})

it('names both plugins in the collision', () => {
  try {
    buildRoutes([enzyme('a', ['status']), enzyme('b', ['status'])], new Map())
    expect.unreachable()
  } catch (e) {
    expect((e as CollisionError).plugins).toEqual(['a', 'b'])
  }
})

it('pins each route to its own command spec, not the enzyme\'s first one', () => {
  const routes = buildRoutes([enzyme('radarr', ['a', 'b'])], new Map())
  expect(routes.get('b')?.spec.name).toBe('b')
})

it('distinguishes a plugin from colliding with itself', () => {
  try {
    buildRoutes([enzyme('a', ['status', 'status'])], new Map())
    expect.unreachable()
  } catch (e) {
    const error = e as CollisionError
    expect(error.plugins).toEqual(['a', 'a'])
    expect(error.message).toContain("declared twice by 'a'")
  }
})

// spec §3.1: the alias is what a caller types; `qualified` is what a role grants. A route map
// keyed by the alias while `qualified` drifted would silently break every stored pattern.
it('keys a route by its alias, keeps qualified canonical, and records what was declared', () => {
  const routes = buildRoutes(
    [enzyme('help', ['help'])],
    new Map([['help.help', 'aide']]),
  )

  expect([...routes.keys()]).toEqual(['aide'])
  expect(routes.get('aide')?.qualified).toBe('help.help')
  expect(routes.get('aide')?.declared).toBe('help')
  expect(routes.get('aide')?.command).toBe('aide')
  expect(routes.has('help')).toBe(false)
})

it('leaves every command of the plugin that has no alias under its declared name', () => {
  const routes = buildRoutes(
    [enzyme('helpdesk', ['links', 'rules'])],
    new Map([['helpdesk.links', 'liens']]),
  )

  expect([...routes.keys()].sort()).toEqual(['liens', 'rules'])
  expect(routes.get('rules')?.declared).toBe('rules')
})

// An alias resolves a collision; it does not suppress the check (spec §3.3).
it('halts when an alias collides with a command nobody renamed', () => {
  expect(() => buildRoutes(
    [enzyme('a', ['status']), enzyme('b', ['other'])],
    new Map([['b.other', 'status']]),
  )).toThrow(CollisionError)
})

it('names the typed name in a collision an alias caused, not the declared one', () => {
  try {
    buildRoutes(
      [enzyme('a', ['status']), enzyme('b', ['other'])],
      new Map([['b.other', 'status']]),
    )
    expect.unreachable()
  } catch (e) {
    expect((e as CollisionError).command).toBe('status')
    expect((e as CollisionError).plugins).toEqual(['a', 'b'])
  }
})

// Two commands renamed to the same word is refused by the store's unique index, so it can
// only be reached by a hand-edited database — and germination must still not route one of them.
it('halts when two aliases collide with each other', () => {
  expect(() => buildRoutes(
    [enzyme('a', ['one']), enzyme('b', ['two'])],
    new Map([['a.one', 'same'], ['b.two', 'same']]),
  )).toThrow(CollisionError)
})
