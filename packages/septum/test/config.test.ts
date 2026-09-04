import { expect, it, test } from 'bun:test'
import { z } from 'zod'
import { defineConfig, toConfigIssue } from '../src/config.js'

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

test('defineConfig carries a declared secret key onto the schema', () => {
  const schema = defineConfig(z.object({ url: z.string(), apiKey: z.string() }), {
    secrets: ['apiKey'],
  })
  expect(schema.secrets).toEqual(['apiKey'])
})

test('defineConfig with no options declares no secret', () => {
  const schema = defineConfig(z.object({ url: z.string() }))
  expect(schema.secrets).toBeUndefined()
})

test('a declared secret does not change how safeParse behaves', () => {
  const schema = defineConfig(z.object({ apiKey: z.string().min(1) }), { secrets: ['apiKey'] })
  expect(schema.safeParse({ apiKey: 'k' }).success).toBe(true)
  expect(schema.safeParse({ apiKey: '' }).success).toBe(false)
})

function keysOf(schema: ReturnType<typeof defineConfig>, input: unknown): string[] {
  const r = schema.safeParse(input)
  if (r.success) throw new Error('expected a refusal')
  return r.error.issues.map((i) => {
    const k = i.messageKey
    return k === undefined ? '(none)' : typeof k === 'string' ? `own:${k}` : `${k.domain}:${k.key}`
  })
}

test('every mapped zod code carries its common key and its parameters', () => {
  const cs = defineConfig(z.object({
    required: z.string(),
    port: z.number().min(1),
    name: z.string().min(3),
    url: z.url({ protocol: /^https?$/ }),
    mode: z.enum(['a', 'b']),
    n: z.number().multipleOf(5),
    arr: z.array(z.string()).min(2),
    loose: z.number().gt(0),
  }).strict())
  // The plural case, deliberately: a corpus of one proves the table exists, never that it maps.
  expect(keysOf(cs, { port: 0, name: 'ab', url: 'plex:32400', mode: 'z', n: 3, arr: [], loose: 0, extra: 1 }))
    .toEqual([
      'common:refusal.config.invalidType',
      'common:refusal.config.tooSmall',
      'common:refusal.config.tooSmall',
      'common:refusal.config.invalidFormat',
      'common:refusal.config.invalidValue',
      'common:refusal.config.notMultipleOf',
      'common:refusal.config.tooSmall',
      'common:refusal.config.tooSmallExclusive',
      'common:refusal.config.unrecognizedKeys',
    ])
})

test('origin is carried, so one key serves string, number and array', () => {
  const cs = defineConfig(z.object({
    s: z.string().min(3), n: z.number().min(3), a: z.array(z.string()).min(3),
  }))
  const r = cs.safeParse({ s: '', n: 0, a: [] })
  if (r.success) throw new Error('expected a refusal')
  expect(r.error.issues.map((i) => i.params?.['origin'])).toEqual(['string', 'number', 'array'])
  expect(r.error.issues.map((i) => i.params?.['minimum'])).toEqual([3, 3, 3])
})

test("a refine's message is a key in the spore's own domain, not a common one", () => {
  const cs = defineConfig(z.object({
    path: z.string().refine((v) => v.startsWith('/'), { error: () => 'config.path.relative' }),
  }))
  expect(keysOf(cs, { path: 'rel' })).toEqual(['own:config.path.relative'])
})

test('an unmapped code yields no key at all, and message stays English', () => {
  // §2.3's last row: the table is a whitelist, so a zod minor adding a code degrades to English
  // rather than rendering a raw dotted key.
  const issue = toConfigIssue({ code: 'not_a_real_code', path: ['x'], message: 'Something' } as never)
  expect(issue.messageKey).toBeUndefined()
  expect(issue.message).toBe('Something')
})

test('an array parameter is joined, so ICU never sees a non-primitive', () => {
  // Unjoined, format() returns an array and the rendered sentence gains a leading comma.
  const cs = defineConfig(z.object({ mode: z.enum(['a', 'b']) }).strict())
  const r = cs.safeParse({ mode: 'z', extra: 1 })
  if (r.success) throw new Error('expected a refusal')
  expect(r.error.issues.map((i) => i.params?.['values'] ?? i.params?.['keys']))
    .toEqual(['a, b', 'extra'])
})

test('message survives every mapping, because the log reads it', () => {
  const cs = defineConfig(z.object({ port: z.number().min(1) }))
  const r = cs.safeParse({ port: 0 })
  if (r.success) throw new Error('expected a refusal')
  expect(r.error.issues[0]?.message).toContain('Too small')
})
