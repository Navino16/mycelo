import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted, writeSpore } from './support.js'
import type { LoggedIn, SporeWriter } from './support.js'
import { listAliases } from '../../src/rhizomorph/aliases.js'

// Two respond-only enzymes both declaring `help`: the smallest real command collision. Neither
// ships a module, so neither needs @mycelo/septum or zod (phase 2's routing decision).
const collidingPair: SporeWriter = (sporesDir) => {
  for (const name of ['alpha', 'beta'] as const) {
    writeSpore(sporesDir, name, {
      'spore.yaml': [
        'kind: enzyme', `name: ${name}`, 'septum: "^0.11"',
        'commands:', '  - name: help', '    description: command.help.description',
        '    respond: reply.help', '',
      ].join('\n'),
    })
  }
}

const greeter: SporeWriter = (sporesDir) => {
  writeSpore(sporesDir, 'greeter', {
    'spore.yaml': [
      'kind: enzyme', 'name: greeter', 'septum: "^0.11"',
      'commands:',
      '  - name: hello', '    description: command.hello.description', '    respond: reply.hello',
      '  - name: bye', '    description: command.bye.description', '    respond: reply.bye', '',
    ].join('\n'),
  })
}

let booted: LoggedIn | undefined
afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  booted = undefined
})

describe('the alias routes', () => {
  it('stores the alias, and the raw stored value is the alias itself', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie, served } = booted

    const answer = await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'salut' },
    })

    expect(answer.statusCode).toBe(200)
    expect(answer.json<{ ok: boolean, restartRequired: boolean }>())
      .toEqual({ ok: true, restartRequired: true })
    // Asserted on the table, not through a DTO that could transform it (phase 8B's lesson).
    expect([...listAliases(served.state.db)]).toEqual([['greeter.hello', 'salut']])
  })

  it('refuses an alias no caller could type, and stores nothing', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie, served } = booted

    const answer = await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'Salut!' },
    })

    expect(answer.statusCode).toBe(400)
    expect(answer.json<{ error: { detail: string } }>().error.detail)
      .toContain("alias 'Salut!' is not a name a caller could type")
    expect([...listAliases(served.state.db)]).toEqual([])
  })

  it('refuses an alias another command holds, naming that command, and keeps the first', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie, served } = booted
    await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'salut' },
    })

    const answer = await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/bye/alias', headers: { cookie },
      payload: { alias: 'salut' },
    })

    expect(answer.statusCode).toBe(400)
    expect(answer.json<{ error: { detail: string } }>().error.detail)
      .toContain("already renames 'greeter.hello'")
    expect([...listAliases(served.state.db)]).toEqual([['greeter.hello', 'salut']])
  })

  it('404s on a command the plugin does not declare', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie } = booted

    const answer = await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/ghost/alias', headers: { cookie },
      payload: { alias: 'fantome' },
    })

    expect(answer.statusCode).toBe(404)
    expect(answer.json<{ error: { message: string } }>().error.message).toContain('ghost')
  })

  it('404s on a plugin that is not installed', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie } = booted

    const answer = await app.inject({
      method: 'PUT', url: '/api/plugins/ghost/commands/hello/alias', headers: { cookie },
      payload: { alias: 'x' },
    })

    expect(answer.statusCode).toBe(404)
  })

  it('reports whether the delete removed anything, so a no-op is not a removal', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie } = booted
    await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'salut' },
    })

    const first = await app.inject({
      method: 'DELETE', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
    })
    const second = await app.inject({
      method: 'DELETE', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
    })

    expect(first.json<{ cleared: boolean }>().cleared).toBe(true)
    expect(second.json<{ cleared: boolean }>().cleared).toBe(false)
  })

  // An alias holds its word in a globally unique column, so a manifest that stopped parsing must
  // not make it unremovable — nothing else could then take that word back (review, finding 8).
  it('clears an alias even after the spore\'s manifest stops parsing', async () => {
    booted = await bootAndLogin({ spores: greeter })
    const { app, cookie, served, dir } = booted
    await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'salut' },
    })
    writeFileSync(join(dir, 'local', 'greeter', 'spore.yaml'), 'kind: enzyme\nname:\n  - broken\n', 'utf8')
    // The control: the write path does refuse, because it must know the command exists.
    const refusedWrite = await app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
      payload: { alias: 'autre' },
    })
    expect(refusedWrite.statusCode).toBe(400)

    const cleared = await app.inject({
      method: 'DELETE', url: '/api/plugins/greeter/commands/hello/alias', headers: { cookie },
    })

    expect(cleared.statusCode).toBe(200)
    expect(cleared.json<{ cleared: boolean }>().cleared).toBe(true)
    expect([...listAliases(served.state.db)]).toEqual([])
  })

  it('is refused without a session', async () => {
    booted = await bootAndLogin({ spores: greeter })

    const answer = await booted.app.inject({
      method: 'PUT', url: '/api/plugins/greeter/commands/hello/alias', payload: { alias: 'x' },
    })

    expect(answer.statusCode).toBe(401)
  })
})

// spec §3.4 and §14.1 step 1: the whole reason the route is HTTP-only. A collision halts
// germination, so there is no bus, no channel and no command — an alias set from a channel
// would be unreachable exactly when it is needed.
describe('the collision loop, from a degraded substrate', () => {
  it('answers in degraded mode, and a retry then germinates', async () => {
    booted = await bootAndLogin({ spores: collidingPair })
    const { app, cookie, served } = booted

    const before = (await app.inject({
      method: 'GET', url: '/api/health', headers: { cookie },
    })).json<{ mode: string, failure?: { kind: string, command: string, plugins: string[] } }>()
    expect(before.mode).toBe('degraded')
    expect(before.failure?.kind).toBe('collision')
    expect(before.failure?.command).toBe('help')
    expect(before.failure?.plugins.sort()).toEqual(['alpha', 'beta'])

    const set = await app.inject({
      method: 'PUT', url: '/api/plugins/beta/commands/help/alias', headers: { cookie },
      payload: { alias: 'aide' },
    })
    expect(set.statusCode).toBe(200)
    // Nothing germinated, so nothing needs restarting — the retry below applies it.
    expect(set.json<{ restartRequired: boolean }>().restartRequired).toBe(false)

    const retried = await app.inject({
      method: 'POST', url: '/api/germination/retry', headers: { cookie },
    })

    expect(retried.statusCode).toBe(200)
    expect(retried.json<{ mode: string }>().mode).toBe('germinated')
    expect([...listAliases(served.state.db)]).toEqual([['beta.help', 'aide']])
  })

  it('answers the same collision again when the alias collides in turn', async () => {
    booted = await bootAndLogin({ spores: collidingPair })
    const { app, cookie } = booted

    // 'help' is what alpha declares, so renaming beta.help to it changes nothing.
    await app.inject({
      method: 'PUT', url: '/api/plugins/beta/commands/help/alias', headers: { cookie },
      payload: { alias: 'help' },
    })
    const retried = await app.inject({
      method: 'POST', url: '/api/germination/retry', headers: { cookie },
    })

    // 200 with mode: degraded, not 409: the retry route refuses only when the substrate is
    // already germinated, so a retry that fails again reports the failure it hit.
    expect(retried.statusCode).toBe(200)
    const body = retried.json<{ mode: string, failure?: { kind: string, command: string } }>()
    expect(body.mode).toBe('degraded')
    expect(body.failure?.kind).toBe('collision')
    expect(body.failure?.command).toBe('help')
  })
})
