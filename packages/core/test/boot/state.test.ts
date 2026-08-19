import { describe, expect, it } from 'bun:test'
import { CycleError } from '../../src/germination/anastomoses.js'
import { CollisionError } from '../../src/germination/registry.js'
import { classifyGerminationFailure, createRuntimeState } from '../../src/boot/state.js'

describe('classifyGerminationFailure', () => {
  it('names every spore of a cycle, not just the first', () => {
    const failure = classifyGerminationFailure(new CycleError(['a', 'b', 'c']))
    expect(failure.kind).toBe('cycle')
    // The plural case deliberately: a classifier that kept only the head would pass a
    // two-element fixture and lose the middle of every real cycle (5.5's survivor shape).
    expect(failure).toMatchObject({ spores: ['a', 'b', 'c'] })
  })

  it('names both plugins of a collision and the command', () => {
    const failure = classifyGerminationFailure(new CollisionError('ping', ['alpha', 'beta']))
    expect(failure).toMatchObject({ kind: 'collision', command: 'ping', plugins: ['alpha', 'beta'] })
  })

  it('carries the original message on both', () => {
    expect(classifyGerminationFailure(new CycleError(['a', 'b'])).message).toContain('a -> b -> a')
    expect(classifyGerminationFailure(new CollisionError('ping', ['alpha', 'beta'])).message)
      .toContain('declared by alpha and beta')
  })

  it('classifies anything else as unknown rather than swallowing it', () => {
    expect(classifyGerminationFailure(new Error('disk on fire')))
      .toEqual({ kind: 'unknown', message: 'disk on fire' })
  })

  it('describes a thrown non-Error instead of printing [object Object]', () => {
    expect(classifyGerminationFailure({ nope: true }).kind).toBe('unknown')
    expect(classifyGerminationFailure({ nope: true }).message).not.toContain('[object Object]')
  })
})

describe('createRuntimeState', () => {
  it('starts in starting, not germinated', () => {
    const state = createRuntimeState(
      {} as Parameters<typeof createRuntimeState>[0],
      {} as Parameters<typeof createRuntimeState>[1],
      {} as Parameters<typeof createRuntimeState>[2],
    )
    expect(state.germination.status).toBe('starting')
  })
})
