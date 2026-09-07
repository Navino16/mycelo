import type { RefusalCode } from '../authorization/refusal.js'
import { SHARED_DOMAIN } from '../i18n/core-catalogs.js'
import { refusalKeyOf } from '../mycelium-refusal.js'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly key: string
  readonly params?: Record<string, unknown>
  readonly detail?: unknown
  /** The catalogue domain `key` lives in. `common` for a refusal a spore also renders (design §4). */
  readonly domain?: string
  constructor(
    status: number, code: string, key: string, params?: Record<string, unknown>, detail?: unknown,
    domain?: string,
  ) {
    // The key, not a sentence: rendering needs a locale, which only the request has.
    super(key)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.key = key
    if (params !== undefined) this.params = params
    if (detail !== undefined) this.detail = detail
    if (domain !== undefined) this.domain = domain
  }
}

export const badRequest = (key: string, params?: Record<string, unknown>, detail?: unknown): ApiError =>
  new ApiError(400, 'validation', key, params, detail)
export const unauthenticated = (key: string, params?: Record<string, unknown>): ApiError =>
  new ApiError(401, 'unauthenticated', key, params)
export const notFound = (key: string, params?: Record<string, unknown>): ApiError =>
  new ApiError(404, 'not-found', key, params)
export const conflict = (key: string, params?: Record<string, unknown>): ApiError =>
  new ApiError(409, 'conflict', key, params)
export const setupRequired = (key: string, params?: Record<string, unknown>): ApiError =>
  new ApiError(503, 'setup-required', key, params)
export const degradedError = (key: string, params?: Record<string, unknown>): ApiError =>
  new ApiError(409, 'degraded', key, params)

/**
 * design §4: a store refusal an HTTP client and a channel reader both see renders from the one
 * `common` entry, so the two audiences cannot drift apart. The status stays the route's choice,
 * and the params are the thrower's — it is the only side that knows which argument the code names.
 */
export const badRequestRefusal = (
  code: RefusalCode, params?: Record<string, unknown>, detail?: unknown,
): ApiError => new ApiError(400, 'validation', refusalKeyOf(code), params, detail, SHARED_DOMAIN)
export const notFoundRefusal = (code: RefusalCode, params?: Record<string, unknown>): ApiError =>
  new ApiError(404, 'not-found', refusalKeyOf(code), params, undefined, SHARED_DOMAIN)
export const conflictRefusal = (code: RefusalCode, params?: Record<string, unknown>): ApiError =>
  new ApiError(409, 'conflict', refusalKeyOf(code), params, undefined, SHARED_DOMAIN)
