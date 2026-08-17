import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { FastifyInstance } from 'fastify'
import { boot, closeBooted, freshDir, setup } from './support.js'
import type { Booted } from './support.js'

let dir: string
let booted: Booted | undefined

beforeEach(() => { dir = freshDir() })
afterEach(async () => {
  if (booted !== undefined) await closeBooted(booted)
  booted = undefined
  rmSync(dir, { recursive: true, force: true })
})

function start(): FastifyInstance {
  booted = boot(dir)
  return booted.app
}

describe('API messages rendered through the translator', () => {
  it('renders a refusal in the reader locale from Accept-Language', async () => {
    // A 401 is reachable before any principal exists, so the header is the only rung
    // resolveApiLocale has — which is exactly the pre-login case.
    const a = start()
    await setup(a)
    const response = await a.inject({
      method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toBe('aucune session valide')
  })

  it('renders the same refusal differently in two locales', async () => {
    // The assertion is that the two bodies DIFFER and each matches its own catalogue.
    // Asserting one locale alone passes against a hardcoded string in that language.
    const a = start()
    await setup(a)
    const en = await a.inject({ method: 'GET', url: '/api/me', headers: { 'accept-language': 'en' } })
    const fr = await a.inject({ method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' } })
    const enMessage = en.json<{ error: { message: string } }>().error.message
    const frMessage = fr.json<{ error: { message: string } }>().error.message
    expect(enMessage).toBe('no valid session')
    expect(frMessage).toBe('aucune session valide')
    expect(enMessage).not.toBe(frMessage)
  })

  it('renders the setup lock refusal, which is emitted before the session gate', async () => {
    // The lock's 503 is the message that would have rendered with locale undefined.
    const a = start()
    const response = await a.inject({
      method: 'GET', url: '/api/me', headers: { 'accept-language': 'fr' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json<{ error: { message: string } }>().error.message)
      .toBe("aucun compte n'existe encore ; créez-en un sur /api/setup")
  })
})
