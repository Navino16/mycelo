import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { enzymeChecks } from '../../src/conformance/enzyme.js'
import type { EnzymeHarness } from '../../src/conformance/enzyme.js'
import { hyphaChecks } from '../../src/conformance/hypha.js'
import type { HyphaHarness } from '../../src/conformance/hypha.js'
import { inhibitorChecks } from '../../src/conformance/inhibitor.js'
import type { InhibitorHarness } from '../../src/conformance/inhibitor.js'
import { rhizaChecks } from '../../src/conformance/rhiza.js'
import type { RhizaHarness } from '../../src/conformance/rhiza.js'
import type { EnzymeContext, InhibitorContext } from '../../src/context.js'
import type { IncomingMessage } from '../../src/message.js'

const config = z.object({ account: z.string() })

const goodHarness: HyphaHarness = {
  name: 'good',
  manifest: {
    kind: 'hypha',
    name: 'good',
    septum: '^1.0',
    capabilities: ['group_membership'],
  },
  module: {
    configSchema: config,
    create: () => ({
      async connect() {},
      listen() {},
      async stop() {},
      async send() {},
      async listGroupMembers() {
        return []
      },
    }),
  },
  validConfig: { account: '+33600000000' },
  invalidConfig: { account: 42 },
}

describe('hypha conformance checks', () => {
  it('passes a correct implementation', async () => {
    const failures = await hyphaChecks(goodHarness)
    expect(failures).toEqual([])
  })

  it('catches a manifest whose kind does not match', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      manifest: { kind: 'rhiza', name: 'good', septum: '^1.0' },
    })
    expect(failures.join(' ')).toContain('kind')
  })

  it('catches group_membership declared but not implemented', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: {
        configSchema: config,
        create: () => ({ async connect() {}, listen() {}, async stop() {}, async send() {} }),
      },
    })
    expect(failures.join(' ')).toContain('listGroupMembers')
  })

  // The core normalises a non-array to null, so the rule an inhibitor wrote against the
  // contract stops applying instead of throwing. The kit is where that surfaces.
  it('calls listGroupMembers when a group id is supplied', async () => {
    expect(await hyphaChecks({ ...goodHarness, membershipGroupId: 'household' })).toEqual([])
  })

  it.each([['undefined', undefined], ['null', null], ['an object', {}]])(
    'catches a listGroupMembers resolving %s instead of an array',
    async (_label, value) => {
      const failures = await hyphaChecks({
        ...goodHarness,
        membershipGroupId: 'household',
        module: {
          configSchema: config,
          create: () => ({
            async connect() {}, listen() {}, async stop() {}, async send() {},
            listGroupMembers: () => Promise.resolve(value),
          }) as never,
        },
      })
      expect(failures.join(' ')).toContain('expected an array')
    },
  )

  it('does not call listGroupMembers unless a group id is supplied', async () => {
    let called = false
    const failures = await hyphaChecks({
      ...goodHarness,
      module: {
        configSchema: config,
        create: () => ({
          async connect() {}, listen() {}, async stop() {}, async send() {},
          async listGroupMembers() { called = true; return [] },
        }),
      },
    })
    expect(failures).toEqual([])
    expect(called).toBe(false)
  })

  it('reports a hypha with no listen()', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: {
        configSchema: config,
        create: () => ({ async connect() {}, async stop() {}, async send() {} }) as never,
      },
    })
    expect(failures.join(' ')).toContain('listen')
  })

  it('catches a config schema that accepts invalid config', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: { configSchema: z.any(), create: () => goodHarness.module.create() },
    })
    expect(failures.join(' ')).toContain('invalid config')
  })

  it('catches a configSchema.toJsonSchema that is present but not callable', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: {
        configSchema: { safeParse: (v: unknown) => config.safeParse(v), toJsonSchema: true } as never,
        create: () => goodHarness.module.create(),
      },
    })
    expect(failures.join(' ')).toContain('toJsonSchema is present but is not a function')
  })
})

// ---------------------------------------------------------------------------
// enzyme
// ---------------------------------------------------------------------------

function enzymeContext(): EnzymeContext<unknown> {
  return {
    config: {},
    logger: { debug() {}, info() {}, warn() {}, error() {}, child: () => enzymeContext().logger },
    async reply() {},
    async push() {},
    rhiza: <T,>() => ({}) as T,
    has: () => false,
    capabilities: { has: () => true, list: () => [] },
    capabilitiesOf: () => ({ has: () => true, list: () => [] }),
    principal: { id: 'p1', identities: [], roles: [] },
    on() {},
  }
}

const goodEnzyme: EnzymeHarness = {
  name: 'good',
  manifest: {
    kind: 'enzyme',
    name: 'links',
    septum: '^1.0',
    commands: [{ name: 'links', description: 'Show links', code: 'links' }],
  },
  module: { create: () => ({ handlers: { links: async () => {} } }) },
  context: enzymeContext,
}

describe('enzyme conformance checks', () => {
  it('passes a correct implementation', async () => {
    expect(await enzymeChecks(goodEnzyme)).toEqual([])
  })

  it('catches a handler that throws', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        create: () => ({
          handlers: {
            async links() {
              throw new Error('boom')
            },
          },
        }),
      },
    })
    expect(failures.join(' ')).toContain('boom')
  })

  it('catches start() without stop()', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: { create: () => ({ handlers: { links: async () => {} }, async start() {} }) },
    })
    expect(failures.join(' ')).toContain('both present or both absent')
  })

  it('does not invoke a command that has required arguments', async () => {
    // A correct enzyme validating its input would throw on empty args. Reporting
    // that as non-conformance would punish the right behaviour, so the kit skips.
    const failures = await enzymeChecks({
      ...goodEnzyme,
      manifest: {
        kind: 'enzyme',
        name: 'radarr-add',
        septum: '^1.0',
        commands: [
          {
            name: 'add',
            description: 'Add a movie',
            code: 'add',
            args: [{ name: 'title', description: 'Title', required: true }],
          },
        ],
      },
      module: {
        create: () => ({
          handlers: {
            async add(inv) {
              if (inv.args['title'] === undefined) throw new Error('missing required arg title')
            },
          },
        }),
      },
    })
    expect(failures).toEqual([])
  })

  it('catches a create() that throws', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        create: () => {
          throw new Error('bad wiring')
        },
      },
    })
    expect(failures.join(' ')).toContain('create() threw')
  })

  it('passes an enzyme whose handlers cover every code command', async () => {
    expect(await enzymeChecks({
      name: 'shared',
      manifest: {
        kind: 'enzyme', name: 'shared', septum: '^0.2',
        commands: [
          { name: 'links', description: 'Service URLs', respond: 'Radarr' },
          { name: 'add', description: 'Add', code: 'mutate' },
        ],
      },
      module: { create: () => ({ handlers: { mutate: async () => {} } }) },
      context: enzymeContext,
    })).toEqual([])
  })

  it('catches a code command with no handler', async () => {
    const failures = await enzymeChecks({
      name: 'broken',
      manifest: {
        kind: 'enzyme', name: 'broken', septum: '^0.2',
        commands: [{ name: 'add', description: 'Add', code: 'mutate' }],
      },
      module: { create: () => ({ handlers: {} }) },
      context: enzymeContext,
    })
    expect(failures.join(' ')).toContain('mutate')
  })

  it('certifies a plugin that ships no module at all', async () => {
    expect(await enzymeChecks({
      name: 'textonly',
      manifest: {
        kind: 'enzyme', name: 'textonly', septum: '^0.2',
        commands: [{ name: 'links', description: 'Service URLs', respond: 'Radarr' }],
      },
      context: enzymeContext,
    })).toEqual([])
  })

  it('refuses a code command with no module at all, naming the missing handler', async () => {
    const failures = await enzymeChecks({
      name: 'needy',
      manifest: {
        kind: 'enzyme', name: 'needy', septum: '^0.2',
        commands: [{ name: 'add', description: 'Add', code: 'mutate' }],
      },
      context: enzymeContext,
    })
    expect(failures.join(' ')).toContain('mutate')
  })

  it('names a missing handler once even when two commands share it', async () => {
    const failures = await enzymeChecks({
      name: 'shared',
      manifest: {
        kind: 'enzyme', name: 'shared', septum: '^0.2',
        commands: [
          { name: 'add', description: 'Add', code: 'mutate' },
          { name: 'remove', description: 'Remove', code: 'mutate' },
        ],
      },
      module: { create: () => ({ handlers: {} }) },
      context: enzymeContext,
    })
    expect(failures.join(' ')).toMatch(/mutate/)
    expect(failures.join(' ').match(/mutate/g)).toHaveLength(1)
  })

  it('names a handler once in the no-module message even when two commands share it', async () => {
    const failures = await enzymeChecks({
      name: 'shared',
      manifest: {
        kind: 'enzyme', name: 'shared', septum: '^0.2',
        commands: [
          { name: 'add', description: 'Add', code: 'mutate' },
          { name: 'remove', description: 'Remove', code: 'mutate' },
        ],
      },
      context: enzymeContext,
    })
    expect(failures.join(' ')).toMatch(/mutate/)
    expect(failures.join(' ').match(/mutate/g)).toHaveLength(1)
  })

  it('catches a configSchema.toJsonSchema that is present but not callable', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        configSchema: { safeParse: () => ({ success: true, data: {} }), toJsonSchema: true } as never,
        create: () => ({ handlers: { links: async () => {} } }),
      },
    })
    expect(failures.join(' ')).toContain('toJsonSchema is present but is not a function')
  })

  // safeParse is mandatory and is only ever invoked, and only when the harness declares a
  // config — so the kit certified a spore germination makes dormant and enable() rejects.
  it('catches a configSchema whose safeParse is not callable', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        configSchema: { safeParse: 'not a function' } as never,
        create: () => ({ handlers: { links: async () => {} } }),
      },
    })
    expect(failures.join(' ')).toContain('configSchema.safeParse is not a function')
  })

  it('catches a safeParse that accepts the valid config but returns no data', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        configSchema: { safeParse: () => ({ success: true }) } as never,
        create: () => ({ handlers: { links: async () => {} } }),
      },
      validConfig: { account: 'x' },
    })
    // ctx.config would be undefined at runtime, and every read off it would throw.
    expect(failures.join(' ')).toContain('no data')
  })

  it('does not certify a handler resolved through Object.prototype', async () => {
    const failures = await enzymeChecks({
      name: 'sneaky',
      manifest: {
        kind: 'enzyme', name: 'sneaky', septum: '^0.2',
        commands: [{ name: 'go', description: 'Go', code: 'constructor' }],
      },
      module: { create: () => ({ handlers: {} }) },
      context: enzymeContext,
    })
    expect(failures.join(' ')).toContain('constructor')
  })
})

// ---------------------------------------------------------------------------
// inhibitor
// ---------------------------------------------------------------------------

function inhibitorContext(): InhibitorContext<unknown> {
  return {
    config: {},
    logger: {
      debug() {}, info() {}, warn() {}, error() {},
      child: () => inhibitorContext().logger,
    },
    async groupMembers() {
      return null
    },
    requireCapability: () => {},
    rhiza: <T,>() => ({}) as T,
    has: () => false,
  }
}

function msg(externalId: string): IncomingMessage {
  return {
    channel: 'conformance',
    conversationId: 'c:1',
    messageId: 'm:1',
    sender: { channel: 'conformance', externalId },
    text: '',
    attachments: [],
    raw: null,
    receivedAt: new Date(0),
  }
}

const goodInhibitor: InhibitorHarness = {
  name: 'allowlist',
  manifest: { kind: 'inhibitor', name: 'allowlist', septum: '^1.0', enforcing: true },
  module: {
    create: () => ({
      async inspect(message) {
        return message.sender.externalId === 'friend'
          ? { allow: true }
          : { allow: false, reason: 'not on the allowlist' }
      },
    }),
  },
  context: inhibitorContext,
  allowed: [msg('friend')],
  denied: [msg('stranger')],
}

describe('inhibitor conformance checks', () => {
  it('passes a correct implementation', async () => {
    expect(await inhibitorChecks(goodInhibitor)).toEqual([])
  })

  it('catches a denial with no reason', async () => {
    // The shape check exists for JavaScript plugins, which get no help from the
    // type. Without it this crashes the kit with a TypeError instead of telling
    // the author what is wrong.
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: { create: () => ({ async inspect() { return { allow: false } as never } }) },
    })
    expect(failures.join(' ')).toContain('without a reason')
  })

  it('catches a verdict that is not an object at all', async () => {
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: { create: () => ({ async inspect() { return undefined as never } }) },
    })
    expect(failures.join(' ')).toContain('expected a Verdict')
  })

  it('catches an inspect() that throws', async () => {
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: {
        create: () => ({
          async inspect(): Promise<never> {
            throw new Error('upstream down')
          },
        }),
      },
    })
    expect(failures.join(' ')).toContain('inspect() threw')
  })

  it('catches allowing a message that should be denied', async () => {
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: { create: () => ({ async inspect() { return { allow: true } as const } }) },
    })
    expect(failures.join(' ')).toContain('expected to be denied')
  })

  it('catches a configSchema.toJsonSchema that is present but not callable', async () => {
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: {
        configSchema: { safeParse: () => ({ success: true, data: {} }), toJsonSchema: true } as never,
        create: () => goodInhibitor.module.create(),
      },
    })
    expect(failures.join(' ')).toContain('toJsonSchema is present but is not a function')
  })
})

// ---------------------------------------------------------------------------
// rhiza
// ---------------------------------------------------------------------------

const goodRhiza: RhizaHarness = {
  name: 'radarr',
  manifest: { kind: 'rhiza', name: 'radarr', septum: '^1.0' },
  module: {
    create: () => ({
      async start() {},
      async stop() {},
      async health() {
        return { state: 'healthy' as const, checkedAt: new Date(0) }
      },
      api: { search: () => [] },
    }),
  },
}

describe('rhiza conformance checks', () => {
  it('passes a correct implementation', async () => {
    expect(await rhizaChecks(goodRhiza)).toEqual([])
  })

  it('catches a missing api — enzymes would resolve undefined through ctx.rhiza()', async () => {
    const failures = await rhizaChecks({
      ...goodRhiza,
      module: {
        create: () =>
          ({
            async start() {}, async stop() {},
            async health() { return { state: 'healthy' as const, checkedAt: new Date(0) } },
          }) as never,
      },
    })
    expect(failures.join(' ')).toContain('no api')
  })

  it('catches an invalid health state', async () => {
    const failures = await rhizaChecks({
      ...goodRhiza,
      module: {
        create: () => ({
          async start() {}, async stop() {},
          async health() { return { state: 'fine' as never, checkedAt: new Date(0) } },
          api: {},
        }),
      },
    })
    expect(failures.join(' ')).toContain("state 'fine'")
  })

  it('catches health() throwing instead of reporting a degraded state', async () => {
    const failures = await rhizaChecks({
      ...goodRhiza,
      module: {
        create: () => ({
          async start() {}, async stop() {},
          async health(): Promise<never> { throw new Error('ECONNREFUSED') },
          api: {},
        }),
      },
    })
    expect(failures.join(' ')).toContain('threw instead of reporting')
  })

  it('catches a configSchema.toJsonSchema that is present but not callable', async () => {
    const failures = await rhizaChecks({
      ...goodRhiza,
      module: {
        configSchema: { safeParse: () => ({ success: true, data: {} }), toJsonSchema: true } as never,
        create: () => goodRhiza.module.create(),
      },
    })
    expect(failures.join(' ')).toContain('toJsonSchema is present but is not a function')
  })
})

// ---------------------------------------------------------------------------
// regressions found reviewing the kit
// ---------------------------------------------------------------------------

describe('regressions', () => {
  it('calls an enzyme start() before its handlers', async () => {
    let started = false
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        create: () => ({
          handlers: {
            async links() {
              if (!started) throw new Error('handler ran before start()')
            },
          },
          async start() {
            started = true
          },
          async stop() {},
        }),
      },
    })
    expect(failures).toEqual([])
  })

  // The runtime hands start() an EnzymeStartContext; EnzymeContext extends it, so passing
  // the fuller stub typechecked and certified an enzyme that throws in the bot.
  it('hands start() a context with no reply, principal or capabilities', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: {
        create: () => ({
          handlers: { links: async () => {} },
          async start(ctx) {
            const seen = ctx as unknown as Record<string, unknown>
            for (const absent of ['reply', 'principal', 'capabilities']) {
              if (seen[absent] !== undefined) throw new Error(`start() saw ${absent}`)
            }
            if (typeof ctx.push !== 'function') throw new Error('start() lost push')
          },
          async stop() {},
        }),
      },
    })
    expect(failures).toEqual([])
  })

  it('lets a harness stub the start context itself', async () => {
    let sawOwnStub = false
    const failures = await enzymeChecks({
      ...goodEnzyme,
      startContext: () => ({ ...enzymeContext(), config: { ownStub: true } }),
      module: {
        create: () => ({
          handlers: { links: async () => {} },
          async start(ctx) {
            sawOwnStub = (ctx.config as { ownStub?: boolean }).ownStub === true
          },
          async stop() {},
        }),
      },
    })
    expect(failures).toEqual([])
    expect(sawOwnStub).toBe(true)
  })

  it('catches a start that is present but not callable', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: { create: () => ({ handlers: { links: async () => {} }, start: true, stop: true }) as never },
    })
    expect(failures.join(' ')).toContain('not callable')
  })

  it('calls an inhibitor start() before inspect()', async () => {
    let allowlist: readonly string[] | null = null
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: {
        create: () => ({
          async inspect(message) {
            if (allowlist === null) throw new Error('inspect() ran before start()')
            return allowlist.includes(message.sender.externalId)
              ? { allow: true }
              : { allow: false, reason: 'not on the allowlist' }
          },
          async start() {
            allowlist = ['friend']
          },
          async stop() {},
        }),
      },
    })
    expect(failures).toEqual([])
  })

  it('does not crash on a verdict JSON.stringify cannot render', async () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const failures = await inhibitorChecks({
      ...goodInhibitor,
      module: { create: () => ({ async inspect() { return circular as never } }) },
    })
    expect(failures.join(' ')).toContain('expected a Verdict')
  })

  it('reports a missing hypha stop() once, not twice', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: {
        configSchema: config,
        create: () =>
          ({
            async connect() {},
            listen() {},
            async send() {},
            async listGroupMembers() {
              return []
            },
          }) as never,
      },
    })
    expect(failures).toEqual(['create() returned no stop()'])
  })

  it('accepts a hypha harness that declares no valid config', async () => {
    const withoutValid: HyphaHarness = { ...goodHarness, validConfig: undefined }
    expect(await hyphaChecks(withoutValid)).toEqual([])
  })
})
