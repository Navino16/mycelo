/** The refusal envelope every route answers with (api/server.ts:50-88): nested under `error`. */
interface Envelope {
  error?: { code?: string, message?: string, detail?: unknown }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly detail: unknown
  readonly body: unknown

  constructor(status: number, code: string | undefined, message: string, body: unknown, detail: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.body = body
  }
}

type Unauthenticated = (kind: 'login' | 'setup') => void

let locale: string | undefined
let notify: Unauthenticated | undefined

/**
 * Lowercased: api/context.ts matches the override against availableLocales() exactly, with no
 * canonicalization, so an uppercase tag falls through and is ignored.
 */
export function setLocaleHeader(next: string): void { locale = next.toLowerCase() }

export function onUnauthenticated(handler: Unauthenticated): void { notify = handler }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ accept: 'application/json' })
  if (locale !== undefined) headers.set('x-mycelo-locale', locale)
  if (body !== undefined) headers.set('content-type', 'application/json')

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const payload: unknown = response.status === 204 || response.headers.get('content-type') === null
    ? undefined
    : await response.json().catch(() => undefined)

  if (!response.ok) {
    const envelope = (payload as Envelope | undefined)?.error
    // The two states phase 6 made public by construction; the router turns them into screens.
    if (response.status === 401) notify?.('login')
    if (response.status === 503 && envelope?.code === 'setup-required') notify?.('setup')
    throw new ApiError(
      response.status, envelope?.code, envelope?.message ?? response.statusText, payload, envelope?.detail,
    )
  }
  return payload as T
}

export const api = {
  get: <T,>(path: string): Promise<T> => request<T>('GET', path),
  send: <T,>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> =>
    request<T>(method, path, body),
}
