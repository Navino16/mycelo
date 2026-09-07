import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineConfig } from '../../src/config.js'
import { configSchemaFailures } from '../../src/conformance/config-checks.js'
import { declaredCatalogKeys } from '../../src/conformance/catalog-keys.js'

const schema = defineConfig(z.object({
  path: z.string().refine((v) => v.startsWith('/'), { error: () => 'config.path.relative' }),
}))

test('a refine key no catalogue declares is a conformance failure', () => {
  const failures = configSchemaFailures(schema, { path: '/ok' }, { path: 'rel' }, {
    en: { config: { other: 'something else' } },
  })
  expect(failures).toEqual([
    "configSchema refuses with key 'config.path.relative', which no supplied catalogue declares",
  ])
})

test('a refine key one catalogue declares passes — a partial contribution is legal', () => {
  // design §7.2 cascades a missing locale to the default, so demanding every locale would fail a
  // plugin the runtime germinates.
  expect(configSchemaFailures(schema, { path: '/ok' }, { path: 'rel' }, {
    en: { config: { path: { relative: 'must be absolute' } } },
    fr: {},
  })).toEqual([])
})

test('no catalogues supplied means no claim to translate, so no failure', () => {
  expect(configSchemaFailures(schema, { path: '/ok' }, { path: 'rel' })).toEqual([])
})

test('a common ref is not checked: the core owns that domain and the kit cannot see it', () => {
  const builtin = defineConfig(z.object({ port: z.number().min(1) }))
  expect(configSchemaFailures(builtin, { port: 8080 }, { port: 0 }, { en: { anything: 'x' } }))
    .toEqual([])
})

test('declaredCatalogKeys flattens to dotted keys, as the runtime does', () => {
  expect([...declaredCatalogKeys({ en: { a: { b: 'x' }, c: 'y' }, fr: { d: 'z' } })].sort())
    .toEqual(['a.b', 'c', 'd'])
})

test('a catalogue that parsed to null is not a fault', () => {
  // catalog.ts reads an empty or comment-only file as a catalogue with no keys.
  expect([...declaredCatalogKeys({ en: null, fr: { a: 'x' } })]).toEqual(['a'])
})

test('a literal refine sentence is not reported when no catalogue declares any key at all', () => {
  const literal = defineConfig(z.object({
    path: z.string().refine((v) => v.startsWith('/'), { error: () => 'must be absolute' }),
  }))
  expect(configSchemaFailures(literal, { path: '/ok' }, { path: 'rel' }, {
    en: null,
    fr: {},
  })).toEqual([])
})

test('a refusal key that only fires on the empty object is caught with no invalidConfig supplied', () => {
  // readSettings hands safeParse {} before any setting is written (design §6), so a plugin's
  // first enable is exactly this probe.
  const requiredOnEmpty = defineConfig(
    z.object({ path: z.string().optional() })
      .refine((v) => v.path !== undefined, { error: () => 'config.path.required' }),
  )
  const failures = configSchemaFailures(requiredOnEmpty, { path: '/ok' }, undefined, {
    en: { config: { other: 'x' } },
  })
  expect(failures).toEqual([
    "configSchema refuses with key 'config.path.required', which no supplied catalogue declares",
  ])
})

test('a key both probes produce is reported once, not twice', () => {
  const bothProbes = defineConfig(
    z.object({ path: z.string().optional() }).refine(
      (v) => v.path !== undefined && v.path.startsWith('/'),
      { error: () => 'config.path.relative' },
    ),
  )
  const failures = configSchemaFailures(bothProbes, { path: '/ok' }, { path: 'rel' }, {
    en: { config: { other: 'x' } },
  })
  expect(failures).toEqual([
    "configSchema refuses with key 'config.path.relative', which no supplied catalogue declares",
  ])
})
