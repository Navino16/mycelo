import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import type { CommandGroups, GraphDto } from '../../src/api/routes/registry.js'
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
    const body = (
      await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })
    ).json<CommandGroups>()
    expect(body).toEqual({})
  })

  it('groups by plugin, without collapsing two plugins into one', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted
    const body = (
      await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })
    ).json<CommandGroups>()
    // Two keys, not one: a groupBy that keyed on something other than the plugin (or
    // collapsed both plugins together) would still pass a single-plugin fixture.
    expect(Object.keys(body).sort()).toEqual(['counter', 'greeter'])
    expect(body.greeter?.map((c) => c.command).sort()).toEqual(['farewell', 'hello'])
    expect(body.counter?.map((c) => c.command).sort()).toEqual(['reset', 'tally'])
    expect(body.greeter?.find((c) => c.command === 'hello')).toMatchObject({
      plugin: 'greeter', qualified: 'greeter.hello',
    })
  })

  it('renders the description through the declaring plugin\'s own catalogue, in the reader\'s locale', async () => {
    booted = await bootAndLogin({ spores: translatedCommand })
    const { app, cookie } = booted
    const en = (await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'accept-language': 'en' },
    })).json<CommandGroups>()
    const fr = (await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'accept-language': 'fr' },
    })).json<CommandGroups>()
    // Asserting one locale alone would pass against a description rendered as its own key.
    expect(en.announcer?.[0]?.description).toBe('Announce loudly')
    expect(fr.announcer?.[0]?.description).toBe('Annoncer bruyamment')
  })

  it('carries a declared capability through, and defaults to none for a command with none', async () => {
    booted = await bootAndLogin({ spores: capabilityCommand })
    const { app, cookie } = booted
    const body = (
      await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })
    ).json<CommandGroups>()
    const byCommand = new Map(body.signaler?.map((c) => [c.command, c]))
    expect(byCommand.get('flagged')?.capabilities).toEqual(['reactions'])
    expect(byCommand.get('plain')?.capabilities).toEqual([])
  })
})

describe('/api/graph', () => {
  it('is empty in degraded mode', async () => {
    booted = await bootAndLogin({ spores: cyclingPair })
    // Otherwise this proves nothing: an empty graph from a fixture that simply had
    // nothing to report is not evidence the degraded guard did anything.
    expect(booted.served.state.germination.status).toBe('degraded')
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

  it('tells a mandatory dependency edge from an optional one, and dedupes a target reached twice', async () => {
    booted = await bootAndLogin({ spores: mandatoryAndOptionalDependency })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const grapherEdges = body.edges.filter((e) => e.from === 'grapher')
    // coreconn is named by two requirements (an any_of and a plain optional one) — exactly
    // two edges out of 'grapher', not three, is what proves edgesOf deduped by target
    // rather than emitting one row per requirement.
    expect(grapherEdges).toHaveLength(2)
    const byTarget = new Map(grapherEdges.map((e) => [e.to, e.optional]))
    // coreconn's any_of requirement is mandatory; its plain requirement is optional. The
    // merge must answer mandatory (false) — an "AND" over both, not whichever was read last.
    expect(byTarget.get('coreconn')).toBe(false)
    expect(byTarget.get('sideconn')).toBe(true)
  })
})
