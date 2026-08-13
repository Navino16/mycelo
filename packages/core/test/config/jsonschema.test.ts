import { expect, it } from 'bun:test'
import { defineConfig } from '@mycelo/septum'
import { z } from 'zod'
import { formSchemaFor } from '../../src/config/jsonschema.js'

it('a plugin with no configSchema has nothing to fill in', () => {
  const result = formSchemaFor(undefined)
  expect(result).toEqual({ available: false, reason: 'this plugin takes no configuration' })
})

it('a convertible schema yields a form carrying the declared property', () => {
  const result = formSchemaFor(defineConfig(z.object({ url: z.string() })))
  expect(result.available).toBe(true)
  if (result.available) {
    const properties = (result.schema as { properties?: Record<string, unknown> }).properties
    expect(properties).toHaveProperty('url')
  }
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

it('a toJsonSchema getter that throws degrades instead of throwing', () => {
  const hostile = {
    get toJsonSchema() {
      throw new Error('boom')
    },
  }
  expect(() => formSchemaFor(hostile)).not.toThrow()
  const result = formSchemaFor(hostile)
  expect(result.available).toBe(false)
})

it('a toJsonSchema returning a non-object is reported, not accepted', () => {
  const handRolled = { toJsonSchema: () => 'not a schema' }
  const result = formSchemaFor(handRolled)
  expect(result.available).toBe(false)
  if (!result.available) expect(result.reason).toContain('did not return an object')
})

it('a toJsonSchema returning an array is rejected, not accepted as a form', () => {
  const handRolled = { toJsonSchema: () => [] }
  const result = formSchemaFor(handRolled)
  expect(result.available).toBe(false)
})

it('a toJsonSchema returning a thenable is rejected, not accepted as a form', () => {
  const handRolled = { toJsonSchema: () => ({ then: () => undefined }) }
  const result = formSchemaFor(handRolled)
  expect(result.available).toBe(false)
})

it('a toJsonSchema that throws a non-Error is skipped by instanceof before message is ever read', () => {
  const poisoned = { get message(): string { throw new Error('escaped') } }
  const hostile = {
    toJsonSchema: () => {
      // Cast only to satisfy the type-aware throw-error lint rule: at runtime this is
      // still the plain object above, exercising a foreign, non-Error throw.
      throw poisoned as unknown as Error
    },
  }
  expect(() => formSchemaFor(hostile)).not.toThrow()
  const result = formSchemaFor(hostile)
  expect(result.available).toBe(false)
})

it('a toJsonSchema that throws a Proxy whose getPrototypeOf trap throws degrades instead of throwing', () => {
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('trap threw')
      },
    },
  )
  const hostile = {
    toJsonSchema: () => {
      // Cast only to satisfy the type-aware throw-error lint rule: at runtime this is
      // still the plain Proxy above, whose prototype trap is what's under test.
      throw hostileProxy as unknown as Error
    },
  }
  expect(() => formSchemaFor(hostile)).not.toThrow()
  const result = formSchemaFor(hostile)
  expect(result.available).toBe(false)
})

it('an Error subclass overriding message with a throwing getter degrades instead of throwing', () => {
  class HostileError extends Error {
    override get message(): string {
      throw new Error('escaped via subclass')
    }
  }
  const hostile = {
    toJsonSchema: () => {
      throw new HostileError()
    },
  }
  expect(() => formSchemaFor(hostile)).not.toThrow()
  const result = formSchemaFor(hostile)
  expect(result.available).toBe(false)
})

it('an Error subclass whose message getter returns an uncoercible object degrades instead of throwing', () => {
  class HostileError extends Error {
    override get message(): string {
      // Returns successfully; the object itself is what refuses to become a string.
      return {
        toString() {
          throw new Error('toString exploded')
        },
        [Symbol.toPrimitive]() {
          throw new Error('toPrimitive exploded')
        },
      } as unknown as string
    }
  }
  const hostile = {
    toJsonSchema: () => {
      throw new HostileError()
    },
  }
  expect(() => formSchemaFor(hostile)).not.toThrow()
  const result = formSchemaFor(hostile)
  expect(result.available).toBe(false)
})
