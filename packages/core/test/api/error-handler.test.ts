import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { boot, closeBooted, freshDir, setup } from './support.js'
import type { Booted } from './support.js'
import { StartupError } from '../../src/identity/bootstrap.js'

let dir: string
let booted: Booted | undefined

beforeEach(() => { dir = freshDir() })
afterEach(async () => {
  if (booted !== undefined) await closeBooted(booted)
  booted = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('the fallback error branch', () => {
  it('renders a StartupError as a translated 500 with no exception detail (spec §9/§10)', async () => {
    booted = boot(dir)
    // Registered directly on the app returned by createServer, before the first ready-forcing
    // call: no request path throws a StartupError today, so this is the proof that the
    // existing catch-all already covers it, in place of an untestable dedicated branch.
    booted.app.get('/api/__boom', () => { throw new StartupError('a raw substrate detail') })
    const cookie = await setup(booted.app)
    const response = await booted.app.inject({ method: 'GET', url: '/api/__boom', headers: { cookie } })
    expect(response.statusCode).toBe(500)
    const body = response.json<{ error: { code: string, message: string } }>()
    expect(body.error.code).toBe('internal')
    expect(body.error.message).toBe('an internal error occurred')
    expect(JSON.stringify(body)).not.toContain('a raw substrate detail')
  })

  // §10 sends the raw fault to the operator's log and a sentence to the client. Inverting
  // the `status !== 429` guard survived the whole suite (campaign M72), which would leave a
  // genuine 500 with no server-side trace at all, and fill the log with limiter noise.
  it("logs a 500's raw fault for the operator and stays silent for a 429", async () => {
    booted = boot(dir)
    booted.app.get('/api/__boom2', () => { throw new Error('a raw substrate detail') })
    const cookie = await setup(booted.app)
    const logged = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await booted.app.inject({ method: 'GET', url: '/api/__boom2', headers: { cookie } })
      expect(logged.mock.calls.flat().join('\n')).toContain('a raw substrate detail')
      logged.mockClear()
      // The 11th failed login is the limiter's own 429, which must not be logged.
      for (let i = 0; i < 11; i += 1) {
        await booted.app.inject({
          method: 'POST', url: '/api/login', payload: { username: 'alice', password: 'wrong' },
        })
      }
      expect(logged).not.toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  }, 20_000)
})
