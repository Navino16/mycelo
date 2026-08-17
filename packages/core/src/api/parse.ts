import { z } from 'zod'
import { badRequest, unauthenticated } from './errors.js'

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequest('the request body is invalid', result.error.issues)
  return result.data
}

export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query)
  if (!result.success) throw badRequest('the query string is invalid', result.error.issues)
  return result.data
}

/** The onRequest hook guarantees this, so `undefined` here is a wiring bug, not a 401. */
export function requirePrincipalId(id: string | undefined): string {
  if (id === undefined) throw unauthenticated('no valid session')
  return id
}
