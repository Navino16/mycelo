import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { runEntry, startupMessage } from '../../src/boot/entry.js'
import type { Running } from '../../src/boot/entry.js'
import { BootstrapError } from '../../src/config.js'
import { DatabaseError } from '../../src/persistence/db.js'
import { StartupError } from '../../src/identity/bootstrap.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-entry-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function config(body: string): string {
  const file = join(dir, 'mycelo.yaml')
  writeFileSync(file, body, 'utf8')
  return file
}

/**
 * Bound and released, so the port is known free at the moment the caller reuses it.
 * A fixed port would collide under parallel runs, and `ui.port` refuses 0 — the schema's
 * `min(1)` makes the ephemeral port reachable through startServer but not through a config.
 */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('probe') })
  const { port } = probe
  await probe.stop(true)
  // Bun.serve types `port` as optional because a unix-socket server has none.
  if (port === undefined) throw new Error('the probe server bound no port')
  return port
}

/**
 * Counted on the prototype, and read through the descriptor rather than as a bare
 * `Database.prototype.close`: an unbound method reference trips
 * @typescript-eslint/unbound-method and this project has no disables.
 */
function spyOnDatabaseClose(): { closes: () => number, restore: () => void } {
  type Close = (this: Database, throwOnError?: boolean) => void
  const original = Object.getOwnPropertyDescriptor(Database.prototype, 'close')?.value as Close
  let count = 0
  Database.prototype.close = function counted(this: Database, throwOnError?: boolean): void {
    count += 1
    original.call(this, throwOnError)
  }
  return { closes: () => count, restore: () => { Database.prototype.close = original } }
}

describe('startupMessage', () => {
  it('reduces a BootstrapError to its sentence, with no path and no stack', () => {
    const message = startupMessage(new BootstrapError('ui.port: too big', 'ui.port'))
    expect(message).toBe('mycelo cannot start: ui.port: too big')
    expect(message).not.toContain('/')
  })

  it('reduces a StartupError the same way', () => {
    expect(startupMessage(new StartupError("defaultRole 'ghost' names no existing role")))
      .toBe("mycelo cannot start: defaultRole 'ghost' names no existing role")
  })

  it('reduces a DatabaseError the same way', () => {
    expect(startupMessage(new DatabaseError('migration failed: disk I/O error')))
      .toBe('mycelo cannot start: migration failed: disk I/O error')
  })

  it('does not swallow an unexpected error: it keeps the stack', () => {
    const message = startupMessage(new TypeError('x is not a function'))
    expect(message).toContain('TypeError')
    expect(message).toContain('entry.test')
  })

  it('falls back to a safe description for a non-Error throw', () => {
    expect(startupMessage({ nope: true })).toBe('mycelo cannot start: unknown error')
  })
})

describe('runEntry', () => {
  it('serves, germinates, and releases the port on close', async () => {
    const port = await freePort()
    const running = await runEntry(config(`spores: ./none\ndatabase: ./d.db\nui:\n  port: ${String(port)}\n`))
    expect(running.state.germination.status).toBe('germinated')
    expect((await fetch(`${running.address}/healthz`)).status).toBe(200)
    const spy = spyOnDatabaseClose()
    try {
      await running.close()
      // SIGINT and SIGTERM can both arrive: the second call must reach neither the server
      // nor the handle.
      await running.close()
    } finally {
      spy.restore()
    }
    expect(spy.closes()).toBe(1)
    expect(fetch(`${running.address}/healthz`)).rejects.toThrow()
  })

  it('listens before it germinates, and stays up when germination degrades', async () => {
    for (const [self, other] of [['alpha', 'beta'], ['beta', 'alpha']] as const) {
      const sporeDir = join(dir, 'spores', self)
      mkdirSync(sporeDir, { recursive: true })
      writeFileSync(join(sporeDir, 'spore.yaml'),
        `kind: rhiza\nname: ${self}\nseptum: "^0.7"\nrequires:\n  - rhiza: ${other}\n`, 'utf8')
    }
    const port = await freePort()
    // Read through the descriptor, not as a bare `console.log`: an unbound method reference
    // trips @typescript-eslint/unbound-method, and this project has no disables.
    type Log = (...args: unknown[]) => void
    const original = Object.getOwnPropertyDescriptor(console, 'log')?.value as Log
    const lines: string[] = []
    console.log = (...args: unknown[]): void => {
      lines.push(args.filter((a): a is string => typeof a === 'string').join(' '))
    }
    let running: Running
    try {
      running = await runEntry(config(`spores: ./spores\ndatabase: ./d.db\nui:\n  port: ${String(port)}\n`))
    } finally {
      console.log = original
    }
    expect(running.state.germination.status).toBe('degraded')
    expect((await fetch(`${running.address}/healthz`)).status).toBe(200)
    await running.close()
    // Order, not just presence: germinating first would answer /healthz just as well, so
    // the ordering claim needs the two log lines to prove it (spec §2.1).
    const listened = lines.findIndex((l) => l.includes('api listening on'))
    const degraded = lines.findIndex((l) => l.includes('germination failed'))
    expect(listened).toBeGreaterThanOrEqual(0)
    expect(degraded).toBeGreaterThan(listened)
  })

  it('releases the port and the database handle when germination throws, then rethrows', async () => {
    // A substrate fault propagates by design (§8.1), and by then runEntry holds a listening
    // port and an open handle. An unreadable spores directory makes syncInstalls throw.
    const port = await freePort()
    const spores = join(dir, 'spores')
    mkdirSync(spores)
    const file = config(`spores: ./spores\ndatabase: ./d.db\nui:\n  port: ${String(port)}\n`)
    chmodSync(spores, 0o000)
    // The count is the only available signal: a throw hands the caller no close(), and
    // bun:sqlite defers the OS-level release, so nothing on disk moves either way.
    const spy = spyOnDatabaseClose()
    let thrown: unknown
    try {
      await runEntry(file)
    } catch (e) {
      thrown = e
    } finally {
      spy.restore()
      chmodSync(spores, 0o755)
    }
    expect(String(thrown)).toContain('EACCES')
    expect(spy.closes()).toBe(1)
    // Would throw EADDRINUSE if runEntry had left the server listening.
    const again = Bun.serve({ port, fetch: () => new Response('ok') })
    await again.stop(true)
  })
})
