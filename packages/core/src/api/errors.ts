export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly key: string
  readonly params?: Record<string, unknown>
  readonly detail?: unknown
  constructor(
    status: number, code: string, key: string, params?: Record<string, unknown>, detail?: unknown,
  ) {
    // The key, not a sentence: rendering needs a locale, which only the request has.
    super(key)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.key = key
    if (params !== undefined) this.params = params
    if (detail !== undefined) this.detail = detail
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
