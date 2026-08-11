import { expect, it } from 'vitest'
import type { Enzyme } from '@mycelo/septum'
import { buildRoutes, CollisionError } from '../../src/germination/registry.js'
import type { GerminatedEnzyme } from '../../src/germination/registry.js'

const instance: Enzyme = { async handle() {} }

function enzyme(name: string, commands: string[]): GerminatedEnzyme {
  return {
    name,
    manifest: {
      kind: 'enzyme', name, septum: '^1.0',
      commands: commands.map((c) => ({ name: c, description: c, code: c })),
    },
    instance,
  }
}

it('indexes commands by short name and records the qualified form', () => {
  const routes = buildRoutes([enzyme('radarr', ['upcoming'])])
  expect(routes.get('upcoming')?.qualified).toBe('radarr.upcoming')
})

it('halts on a command declared by two plugins', () => {
  expect(() => buildRoutes([enzyme('a', ['status']), enzyme('b', ['status'])]))
    .toThrow(CollisionError)
})

it('names both plugins in the collision', () => {
  try {
    buildRoutes([enzyme('a', ['status']), enzyme('b', ['status'])])
    expect.unreachable()
  } catch (e) {
    expect((e as CollisionError).plugins).toEqual(['a', 'b'])
  }
})

it('distinguishes a plugin from colliding with itself', () => {
  try {
    buildRoutes([enzyme('a', ['status', 'status'])])
    expect.unreachable()
  } catch (e) {
    const error = e as CollisionError
    expect(error.plugins).toEqual(['a', 'a'])
    expect(error.message).toContain("declared twice by 'a'")
  }
})
