import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'bun:test'
import type { CommandGroups, GraphDto } from '../../src/api/routes/registry.js'
import {
  bootAndLogin, brokenManifest, capabilityCommand, closeBooted, cyclingPair,
  degradedRhizaWithDependent, dormantDependency,
  mandatoryAndOptionalDependency, translatedCommand, twoPluginsTwoCommands, configurable,
  unhealthyRhiza, writeSpore } from './support.js'
import type { LoggedIn } from './support.js'
import { recordInstall, setEnabled } from '../../src/config/store.js'
import { setAlias } from '../../src/rhizomorph/aliases.js'

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

  // spec §3.5: the typed name and the declared one are different facts. Asserting only that
  // 'salut' appears would pass on a DTO reporting it as the declared name too — assert the
  // pairing, and the unrenamed sibling beside it.
  it('reports the alias as the typed name and the manifest name as the declared one', async () => {
    booted = await bootAndLogin({
      spores: twoPluginsTwoCommands,
      beforeServe: (db) => {
        recordInstall(db, 'greeter', 'enzyme')
        setEnabled(db, 'greeter', true)
        setAlias(db, 'greeter', 'hello', 'salut')
      },
    })
    const { app, cookie } = booted
    const body = (
      await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })
    ).json<CommandGroups>()

    expect(body.greeter?.map((c) => c.command).sort()).toEqual(['farewell', 'salut'])
    expect(body.greeter?.find((c) => c.qualified === 'greeter.hello'))
      .toMatchObject({ command: 'salut', declared: 'hello' })
    expect(body.greeter?.find((c) => c.qualified === 'greeter.farewell'))
      .toMatchObject({ command: 'farewell', declared: 'farewell' })
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

  // needs-config parses and then refuses its empty configuration: the commonest dormancy of a
  // fresh substrate, which the UI must file under its kind, not under "manifest did not parse".
  it('gives a dormant node whose manifest parsed the kind its install row recorded', async () => {
    booted = await bootAndLogin({ spores: configurable })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const node = body.nodes.find((n) => n.name === 'needs-config')
    expect(node).toMatchObject({ kind: 'enzyme', state: 'dormant' })
    expect(node?.reason).toContain('configuration')
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

describe('/api/graph draws what actually broke', () => {
  // Measured on the real substrate: `now-watching` was dormant *because* `plex` was, and the
  // graph drew no edge between them — `3 links · 0 broken` over the one failure it exists to
  // show. edgesOf walked germinated spores only, whose `resolved` cannot name a dormant one.
  it('emits the edge from a dormant spore to the dependency that broke it', async () => {
    booted = await bootAndLogin({ spores: dormantDependency })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const byName = new Map(body.nodes.map((n) => [n.name, n]))

    // The premise: both ends are dormant, or the edge proves nothing.
    expect(byName.get('plexish')?.state).toBe('dormant')
    expect(byName.get('watcher')?.state).toBe('dormant')
    expect(body.edges).toContainEqual({ from: 'watcher', to: 'plexish', optional: false })
  })

  // An any_of alternative nobody installed has no node, so an edge to it could be neither
  // placed nor drawn — Graph.tsx drops such an edge, and the count would still have moved.
  it('draws no edge to an any_of alternative that is not installed', async () => {
    booted = await bootAndLogin({ spores: dormantDependency })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()

    expect(body.nodes.some((n) => n.name === 'jellyfinish')).toBe(false)
    expect(body.edges).toContainEqual({ from: 'chooser', to: 'plexish', optional: false })
    expect(body.edges.some((e) => e.to === 'jellyfinish')).toBe(false)
  })

  // A germinated spore's edges come from `resolved`, which is the stricter source: a dormant
  // spore's declared targets must not be read for one that wired.
  it('keeps drawing a germinated spore’s edges from what it resolved', async () => {
    booted = await bootAndLogin({ spores: mandatoryAndOptionalDependency })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()

    // 'nowhere' is an any_of alternative that is not installed: no node, so no edge.
    expect(body.edges.some((e) => e.to === 'nowhere')).toBe(false)
    expect(body.edges.filter((e) => e.from === 'grapher')).toHaveLength(2)
  })

  // ruling F11: the Overview reads `radarr · Degraded · HTTP 401` off /api/health while the
  // graph called the same plugin germinated in the same second, and the graph is the one
  // claiming everything is fine.
  it('carries a rhiza’s runtime health into its node state, not only its germination', async () => {
    booted = await bootAndLogin({ spores: degradedRhizaWithDependent })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()
    const node = body.nodes.find((n) => n.name === 'wobbly')

    expect(node).toMatchObject({ kind: 'rhiza', state: 'degraded' })
    expect(node?.reason).toBe('HTTP 401')
    // The edge itself is intact — its end is what the client reads as broken.
    expect(body.edges).toContainEqual({ from: 'seeker', to: 'wobbly', optional: false })
  })

  it('reports a rhiza whose health() threw as unreachable, never as germinated', async () => {
    booted = await bootAndLogin({ spores: unhealthyRhiza })
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()

    expect(body.nodes.find((n) => n.name === 'flapping')).toMatchObject({ state: 'unreachable' })
  })

  // The control: a healthy rhiza stays germinated, or every node would read as failing.
  it('leaves a healthy rhiza germinated', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    const body = (await app.inject({ method: 'GET', url: '/api/graph', headers: { cookie } })).json<GraphDto>()

    expect(body.nodes.find((n) => n.name === 'mock')).toMatchObject({ state: 'germinated' })
  })
})

describe('the synthetic core node', () => {
  it('emits a germinated core node even when nothing requires the mycelium', async () => {
    booted = await bootAndLogin({ spores: twoPluginsTwoCommands })
    const { app, cookie } = booted

    const graph = (await app.inject({
      method: 'GET', url: '/api/graph', headers: { cookie },
    })).json<{ nodes: { name: string, state: string }[], edges: { from: string, to: string }[] }>()

    expect(graph.nodes.find((n) => n.name === 'core')).toEqual({ name: 'core', state: 'germinated' })
    expect(graph.edges.filter((e) => e.to === 'core')).toEqual([])
  })

  /**
   * germinate.ts does not refuse a spore named 'core' — it makes it dormant with the reserved
   * translation-domain reason, and the comment on CORE_NODE claimed the opposite. Two nodes of
   * that name duplicate a React key in Graph.tsx and collapse in its `byName` index.
   */
  it('answers exactly one node named core when a dormant spore claims the name', async () => {
    booted = await bootAndLogin({
      spores: (dir) => {
        writeSpore(dir, 'core', { 'spore.yaml': 'kind: rhiza\nname: core\nseptum: "^0.11"\n' })
      },
    })
    const { app, cookie } = booted
    // The premise: the spore is dormant rather than absent, or this proves nothing.
    const state = booted.served.state.germination
    expect(state.status).toBe('germinated')
    expect(state.status === 'germinated' && state.mycelium.registry.dormant.map((d) => d.name))
      .toContain('core')

    const graph = (await app.inject({
      method: 'GET', url: '/api/graph', headers: { cookie },
    })).json<GraphDto>()

    expect(graph.nodes.filter((n) => n.name === 'core')).toEqual([{ name: 'core', state: 'germinated' }])
  })

  it('routes a rhiza: mycelium requirement to the core node instead of dropping it', async () => {
    booted = await bootAndLogin({
      spores: (dir) => {
        writeSpore(dir, 'reader', {
          'spore.yaml': 'kind: enzyme\nname: reader\nseptum: "^0.11"\n'
            + 'commands:\n  - name: who\n    description: command.who.description\n    respond: who.text\n'
            + 'requires:\n  - rhiza: mycelium\n    scopes: [principals.read]\n',
          'translations/en.yaml': 'command:\n  who:\n    description: Who\nwho:\n  text: ok\n',
        })
      },
    })
    const { app, cookie } = booted

    const graph = (await app.inject({
      method: 'GET', url: '/api/graph', headers: { cookie },
    })).json<{ edges: { from: string, to: string, optional: boolean }[] }>()

    expect(graph.edges).toContainEqual({ from: 'reader', to: 'core', optional: false })
    // The old name must not survive alongside the new one, or the client draws both.
    expect(graph.edges.some((e) => e.to === 'mycelium')).toBe(false)
  })
})
