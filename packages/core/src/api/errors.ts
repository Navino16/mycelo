export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: unknown
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

export const badRequest = (message: string, detail?: unknown): ApiError =>
  new ApiError(400, 'validation', message, detail)
export const unauthenticated = (message: string): ApiError =>
  new ApiError(401, 'unauthenticated', message)
export const notFound = (message: string): ApiError => new ApiError(404, 'not-found', message)
export const conflict = (message: string): ApiError => new ApiError(409, 'conflict', message)
export const setupRequired = (message: string): ApiError =>
  new ApiError(503, 'setup-required', message)
export const degradedError = (message: string): ApiError => new ApiError(409, 'degraded', message)
