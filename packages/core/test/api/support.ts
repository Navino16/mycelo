import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../../src/api/server.js'
import { SESSION_COOKIE } from '../../src/api/sessions.js'
import { serve } from '../../src/boot/serve.js'
import type { Served } from '../../src/boot/serve.js'

export interface Booted {
  app: FastifyInstance
  served: Served
}

export function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mycelo-api-'))
}

/** `extra` is raw YAML appended to a minimal `mycelo.yaml`; `trustProxy` defaults to off. */
export function boot(dir: string, extra = '', trustProxy = false): Booted {
  writeFileSync(join(dir, 'mycelo.yaml'), `spores: ./none\ndatabase: ./d.db\n${extra}`, 'utf8')
  const served = serve(join(dir, 'mycelo.yaml'))
  const app = createServer({ trustProxy, state: served.state })
  return { app, served }
}

export interface Credentials {
  username: string
  password: string
}

const DEFAULT_CREDENTIALS: Credentials = { username: 'alice', password: 'correct horse' }

/** Runs the setup wizard and returns a ready-to-use `Cookie` header value. */
export async function setup(app: FastifyInstance, credentials = DEFAULT_CREDENTIALS): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/setup', payload: credentials })
  if (response.statusCode !== 200) {
    throw new Error(`setup failed with ${String(response.statusCode)}: ${response.body}`)
  }
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
  if (cookie === undefined) throw new Error('setup returned no session cookie')
  return `${SESSION_COOKIE}=${cookie.value}`
}

export async function closeBooted(booted: Booted): Promise<void> {
  await booted.app.close()
  booted.served.closeDb()
}
