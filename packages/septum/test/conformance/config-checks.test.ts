import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineConfig } from '../../src/config.js'
import { configSchemaFailures } from '../../src/conformance/config-checks.js'

test('a secret naming a declared field is accepted', () => {
  const schema = defineConfig(z.object({ url: z.string(), apiKey: z.string() }), {
    secrets: ['apiKey'],
  })
  expect(configSchemaFailures(schema, undefined, undefined)).toEqual([])
})

test('a secret naming a field the schema does not declare is a failure that names it', () => {
  const schema = defineConfig(z.object({ url: z.string() }), { secrets: ['apiKye'] })
  const failures = configSchemaFailures(schema, undefined, undefined)
  expect(failures).toHaveLength(1)
  expect(failures[0]).toContain('apiKye')
})

test('every undeclared secret is named, not only the first', () => {
  const schema = defineConfig(z.object({ url: z.string() }), { secrets: ['alpha', 'beta'] })
  const joined = configSchemaFailures(schema, undefined, undefined).join(' ')
  expect(joined).toContain('alpha')
  expect(joined).toContain('beta')
})

test('a schema publishing no JSON Schema is not checked', () => {
  const failures = configSchemaFailures(
    { safeParse: (input: unknown) => ({ success: true as const, data: input }), secrets: ['whatever'] },
    undefined,
    undefined,
  )
  expect(failures).toEqual([])
})

test('an explicitly open schema is exempt, as it is in the core', () => {
  const schema = defineConfig(z.looseObject({ url: z.string() }), { secrets: ['anything'] })
  expect(configSchemaFailures(schema, undefined, undefined)).toEqual([])
})
