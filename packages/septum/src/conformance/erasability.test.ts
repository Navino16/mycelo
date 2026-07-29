import { describe, expect, it } from 'vitest'
import { assertErasable, erasabilityError } from './erasability.js'

const BANNED = {
  enum: 'export enum K { A }',
  'const enum': 'export const enum K { A = 1 }',
  namespace: 'export namespace N { export const a = 1 }',
  'parameter property': 'export class C { constructor(private x: string) {} }',
  decorator: [
    'function d<T>(t: T, _c: ClassMethodDecoratorContext): T { return t }',
    'export class S { @d p(): string { return "x" } }',
  ].join('\n'),
}

describe('erasabilityError', () => {
  it('accepts conforming TypeScript, including types and imports', () => {
    const source = [
      'import { join } from "node:path"',
      'export const KINDS = ["a", "b"] as const',
      'export type Kind = (typeof KINDS)[number]',
      'export interface Shape { k: Kind }',
      'export function f(p: string): string { return join(p, "x") }',
      'export class C { readonly x: string; constructor(x: string) { this.x = x } }',
    ].join('\n')
    expect(erasabilityError(source)).toBeNull()
  })

  for (const [name, source] of Object.entries(BANNED)) {
    it(`rejects ${name}`, () => {
      expect(erasabilityError(source)).not.toBeNull()
    })
  }

  it('reports three of the TypeScript-only constructs by name at strip time', () => {
    // These fail before any JavaScript is parsed, so the message comes from Node's
    // stripper and names the construct. `const enum` is deliberately absent: Node
    // reports it with the byte-identical message as plain `enum`, so it cannot be
    // distinguished here. Its rejection is covered by the loop above.
    expect(erasabilityError(BANNED.enum)).toContain('enum')
    expect(erasabilityError(BANNED.namespace)).toContain('namespace')
    expect(erasabilityError(BANNED['parameter property'])).toContain('parameter property')
  })

  it('reports a decorator only after stripping', () => {
    // The decorator survives stripping — TypeScript considers it future JavaScript —
    // and is caught when the resulting module is parsed. This distinction is the
    // whole reason the check has two stages.
    const reason = erasabilityError(BANNED.decorator)
    expect(reason).toContain('after stripping')
  })
})

describe('assertErasable', () => {
  it('is silent on conforming source', () => {
    expect(() => assertErasable('export const a: number = 1')).not.toThrow()
  })

  it('throws with the reason on banned source', () => {
    expect(() => assertErasable(BANNED.enum)).toThrow(/enum/)
  })
})
