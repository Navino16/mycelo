import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
      async start() {},
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
        create: () => ({ async start() {}, async stop() {}, async send() {} }),
      },
    })
    expect(failures.join(' ')).toContain('listGroupMembers')
  })

  it('catches a config schema that accepts invalid config', async () => {
    const failures = await hyphaChecks({
      ...goodHarness,
      module: { configSchema: z.any(), create: () => goodHarness.module.create() },
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
})

// ---------------------------------------------------------------------------
// erasability wired into the harnesses
// ---------------------------------------------------------------------------

describe('source erasability through a harness', () => {
  it('reports a source file the local driver could not load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mycelo-kit-'))
    const file = join(dir, 'plugin.ts')
    try {
      writeFileSync(file, 'export enum Bad { A }\n', 'utf8')
      const failures = await rhizaChecks({ ...goodRhiza, sourcePaths: [file] })
      expect(failures.join(' ')).toContain('is not erasable')
      expect(failures.join(' ')).toContain('enum')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stays silent on conforming source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mycelo-kit-'))
    const file = join(dir, 'plugin.ts')
    try {
      writeFileSync(file, 'export const K = ["a"] as const\nexport type K = (typeof K)[number]\n', 'utf8')
      expect(await rhizaChecks({ ...goodRhiza, sourcePaths: [file] })).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports an unreadable path rather than throwing', async () => {
    const failures = await rhizaChecks({ ...goodRhiza, sourcePaths: ['/nonexistent/x.ts'] })
    expect(failures.join(' ')).toContain('cannot read source')
  })
})

// ---------------------------------------------------------------------------
// regressions found reviewing the kit
// ---------------------------------------------------------------------------

describe('regressions', () => {
  it('keeps erasability failures when the manifest is rejected', async () => {
    // The manifest early-returns used to build a fresh array, so the author saw
    // only the manifest error and learned about the unloadable source one run later.
    const dir = mkdtempSync(join(tmpdir(), 'mycelo-kit-'))
    const file = join(dir, 'plugin.ts')
    try {
      writeFileSync(file, 'export enum Bad { A }\n', 'utf8')
      const failures = await enzymeChecks({
        ...goodEnzyme,
        manifest: { kind: 'rhiza', name: 'links', septum: '^1.0' },
        sourcePaths: [file],
      })
      expect(failures.join(' ')).toContain('is not erasable')
      expect(failures.join(' ')).toContain("expected 'enzyme'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

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
            async start() {},
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
