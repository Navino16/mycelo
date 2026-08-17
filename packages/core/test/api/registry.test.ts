import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import type { CommandDto, GraphDto } from '../../src/api/routes/registry.js'
import {
  bootAndLogin, brokenManifest, capabilityCommand, closeBooted, cyclingPair,
  mandatoryAndOptionalDependency, translatedCommand, twoPluginsTwoCommands,
} from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined

afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  rmSync(booted.dir, { recursive: true, force: true })
  booted = undefined
})

describe('/api/commands', () => {
  it('is empty in degraded mode', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    expect(booted.served.state.germination.status).toBe('degraded')
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })).json<CommandDto[]>()
    expect(body).toEqual([])
  })

  it('lists every plugin and every command, without collapsing two plugins into one', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })).json<CommandDto[]>()
    const byQualified = new Map(body.map((c) => [c.qualified, c]))
    expect(byQualified.size).toBe(4)
    expect(byQualified.get('greeter.hello')).toMatchObject({ plugin: 'greeter', command: 'hello' })
    expect(byQualified.get('greeter.farewell')).toMatchObject({ plugin: 'greeter', command: 'farewell' })
    expect(byQualified.get('counter.tally')).toMatchObject({ plugin: 'counter', command: 'tally' })
    expect(byQualified.get('counter.reset')).toMatchObject({ plugin: 'counter', command: 'reset' })
  })

  it('renders the description through the declaring plugin\'s own catalogue, in the reader\'s locale', async () => {
    booted = await bootAndLogin({ spores: translatedCommand })
    const { app, cookie } = booted
    const en = (await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'accept-language': 'en' },
    })).json<CommandDto[]>()
    const fr = (await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'accept-language': 'fr' },
    })).json<CommandDto[]>()
    // Asserting one locale alone would pass against a description rendered as its own key.
    expect(en[0]?.description).toBe('Announce loudly')
    expect(fr[0]?.description).toBe('Annoncer bruyamment')
  })

  it('carries a declared capability through, and defaults to none for a command with none', async () => {
    booted = await bootAndLogin({ spores: capabilityCommand })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })).json<CommandDto[]>()
    const byQualified = new Map(body.map((c) => [c.qualified, c]))
    expect(byQualified.get('signaler.flagged')?.capabilities).toEqual(['reactions'])
    expect(byQualified.get('signaler.plain')?.capabilities).toEqual([])
  })
})

describe('/api/graph', () => {
  it('is empty in degraded mode', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    expect(body).toEqual({ nodes: [], edges: [] })
  })

  it('lists a node per germinated kind, each carrying its own kind and state', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const byName = new Map(body.nodes.map((n) => [n.name, n]))
    // fixtures: console (hypha), mock (rhiza), ping (enzyme), gate (inhibitor).
    expect(byName.get('console')).toMatchObject({ kind: 'hypha', state: 'germinated' })
    expect(byName.get('mock')).toMatchObject({ kind: 'rhiza', state: 'germinated' })
    expect(byName.get('ping')).toMatchObject({ kind: 'enzyme', state: 'germinated' })
    expect(byName.get('gate')).toMatchObject({ kind: 'inhibitor', state: 'germinated' })
  })

  it('lists a dormant node with no kind, and does not drop it', async () => {
    booted = await bootAndLogin({ spores: brokenManifest })
    const { app, cookie } = booted
    expect(booted.served.state.germination.status).toBe('germinated')
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const broken = body.nodes.find((n) => n.name === 'brokenyaml')
    expect(broken).toMatchObject({ state: 'dormant' })
    expect(broken?.kind).toBeUndefined()
    expect(broken?.reason).toBeDefined()
  })

  it('tells a mandatory dependency edge from an optional one, not just one of the two', async () => {
    booted = await bootAndLogin({ spores: mandatoryAndOptionalDependency })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const byTarget = new Map(body.edges.filter((e) => e.from === 'grapher').map((e) => [e.to, e.optional]))
    expect(byTarget.size).toBe(2)
    expect(byTarget.get('coreconn')).toBe(false)
    expect(byTarget.get('sideconn')).toBe(true)
  })
})
