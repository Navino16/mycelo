import { afterEach, describe, expect, it } from 'bun:test'
import type { FastifyInstance } from 'fastify'
import { createServer, startServer } from '../../src/api/server.js'

let app: FastifyInstance | undefined
afterEach(async () => { await app?.close(); app = undefined })

describe('the HTTP server', () => {
  it('answers /healthz over a real TCP socket', async () => {
    app = createServer({ trustProxy: false })
    // Port 0 lets the OS pick: a fixed port makes the suite fail under parallel runs.
    const address = await startServer(app, { bind: '127.0.0.1', port: 0, trustProxy: false, resetAccount: false })
    const response = await fetch(`${address}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('says nothing about germination on /healthz', async () => {
    app = createServer({ trustProxy: false })
    const address = await startServer(app, { bind: '127.0.0.1', port: 0, trustProxy: false, resetAccount: false })
    // spec §17.5: the container probe must not fail on degraded mode, so it must not
    // report it either — a body carrying germination state invites exactly that coupling.
    expect(Object.keys(await (await fetch(`${address}/healthz`)).json() as object)).toEqual(['ok'])
  })
})
