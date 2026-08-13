import { expect, it } from 'bun:test'
import { defineConfig } from '@mycelo/septum'
import { z } from 'zod'
import { formSchemaFor } from '../../src/config/jsonschema.js'

it('a plugin with no configSchema has nothing to fill in', () => {
  const result = formSchemaFor(undefined)
  expect(result).toEqual({ available: false, reason: 'this plugin takes no configuration' })
})

it('a convertible schema yields a form', () => {
  const result = formSchemaFor(defineConfig(z.object({ url: z.string() })))
  expect(result.available).toBe(true)
})

it('a schema that cannot be converted degrades instead of throwing', () => {
  const result = formSchemaFor(defineConfig(z.object({ f: z.custom(() => true) })))
  expect(result.available).toBe(false)
  if (!result.available) expect(result.reason).toContain('cannot be converted')
})

it('a configSchema without toJsonSchema is reported, not treated as absent', () => {
  const handRolled = { safeParse: () => ({ success: true as const, data: {} }) }
  const result = formSchemaFor(handRolled)
  expect(result.available).toBe(false)
  if (!result.available) expect(result.reason).toContain('no JSON Schema')
})
