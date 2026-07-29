import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { enzymeChecks } from './enzyme.js'
import type { EnzymeHarness } from './enzyme.js'
import { hyphaChecks } from './hypha.js'
import type { HyphaHarness } from './hypha.js'
import { inhibitorChecks } from './inhibitor.js'
import type { InhibitorHarness } from './inhibitor.js'
import type { EnzymeContext, InhibitorContext } from '../context.js'
import type { IncomingMessage } from '../message.js'

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
    create: () =>
      ({
        async start() {},
        async stop() {},
        async send() {},
        async listGroupMembers() {
          return []
        },
      }) as never,
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
        create: () => ({ async start() {}, async stop() {}, async send() {} }) as never,
      },
    })
    expect(failures.join(' ')).toContain('listGroupMembers')
  })

  it('catches a config schema that accepts invalid config', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: { configSchema: z.any(), create: goodHarness.module.create },
    })
    expect(failures.join(' ')).toContain('invalid config')
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
    commands: [{ name: 'links', description: 'Show links' }],
  },
  module: { create: () => ({ async handle() {} }) },
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
          async handle() {
            throw new Error('boom')
          },
        }),
      },
    })
    expect(failures.join(' ')).toContain('boom')
  })

  it('catches start() without stop()', async () => {
    const failures = await enzymeChecks({
      ...goodEnzyme,
      module: { create: () => ({ async handle() {}, async start() {} }) },
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
            args: [{ name: 'title', description: 'Title', required: true }],
          },
        ],
      },
      module: {
        create: () => ({
          async handle(inv) {
            if (inv.args['title'] === undefined) throw new Error('missing required arg title')
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
})
