import { expect, it } from 'bun:test'
import { z } from 'zod'
import { defineConfig } from '../src/config.js'

it('defineConfig keeps safeParse working', () => {
  const cs = defineConfig(z.object({ url: z.string().min(1) }))
  expect(cs.safeParse({ url: 'http://x' })).toEqual({ success: true, data: { url: 'http://x' } })
  expect(cs.safeParse({}).success).toBe(false)
})

it('a field with a default is not required in the emitted schema', () => {
  const cs = defineConfig(z.object({ url: z.string(), port: z.number().default(8080) }))
  const emitted = cs.toJsonSchema?.() as { required?: string[] }
  // Zod's default io is 'output', where a defaulted field IS required — which would make
  // every generated form demand a value the schema already knows how to supply.
  expect(emitted.required).toEqual(['url'])
})

it('an unconvertible schema throws from toJsonSchema, not from defineConfig', () => {
  const cs = defineConfig(z.object({ f: z.custom(() => true) }))
  expect(cs.safeParse({ f: 1 }).success).toBe(true)
  expect(() => cs.toJsonSchema?.()).toThrow()
})
