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

/**
 * A JavaScript plugin, or any hand-written `ConfigSchema`, has no compiler to stop these — so
 * the cast is the whole point. The core answers `[]` for every one of them; the kit must not
 * throw out of the author's only diagnostic tool, and must still say what is wrong.
 */
function malformed(secrets: unknown, toJsonSchema?: unknown): Parameters<typeof configSchemaFailures>[0] {
  return {
    safeParse: (input: unknown) => ({ success: true as const, data: input }),
    secrets,
    toJsonSchema: toJsonSchema ?? (() => ({ type: 'object', properties: { url: {} } })),
  } as unknown as Parameters<typeof configSchemaFailures>[0]
}

test('a secrets declaration that is a string is reported, not thrown on', () => {
  const failures = configSchemaFailures(malformed('token'), undefined, undefined)
  expect(failures).toEqual(['configSchema.secrets is present but is not an array of strings'])
})

test('a non-string entry in secrets is reported and never named as an undeclared key', () => {
  const failures = configSchemaFailures(malformed(['url', 42]), undefined, undefined)
  expect(failures).toEqual(['configSchema.secrets holds an entry that is not a string, which the core ignores'])
})

test('a toJsonSchema returning a thenable is not read as a schema', () => {
  const thenable = () => ({ then: () => {}, properties: {} })
  expect(configSchemaFailures(malformed(['apiKey'], thenable), undefined, undefined)).toEqual([])
})

test('a toJsonSchema exposed as a throwing getter is survived', () => {
  const schema = {
    safeParse: (input: unknown) => ({ success: true as const, data: input }),
    secrets: ['apiKey'],
    get toJsonSchema(): unknown { throw new Error('boom') },
  } as unknown as Parameters<typeof configSchemaFailures>[0]
  expect(configSchemaFailures(schema, undefined, undefined)).toEqual([])
})
