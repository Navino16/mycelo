import { describe, expect, it } from 'bun:test'
import type { IncomingMessage, InhibitorContext, Logger, Verdict } from '@mycelo/septum'
import { createAdmissionChain, createInhibitorContext } from '../../src/admission/chain.js'
import type { GerminatedInhibitor, GerminatedRhiza } from '../../src/germination/registry.js'

function inhibitor(
  name: string,
  enforcing: boolean,
  inspect: () => Promise<Verdict>,
): GerminatedInhibitor {
  return {
    name, config: {}, resolved: new Set(), scopes: [],
    manifest: { kind: 'inhibitor', name, septum: '^0.5', enforcing },
    instance: { inspect },
  } as unknown as GerminatedInhibitor
}

const message: IncomingMessage = {
  channel: 'console', conversationId: 'c1', messageId: 'm1',
  sender: { channel: 'console', externalId: 'alice' },
  text: '/ping', attachments: [], raw: null, receivedAt: new Date(),
}

function chain(
  inhibitors: readonly GerminatedInhibitor[],
  brokenEnforcing: string[] = [],
  scopes: ReadonlyMap<string, readonly string[]> = new Map(),
) {
  const warnings: string[] = []
  const errors: string[] = []
  // Records the child bindings each record carried, so attribution is assertable and not
  // merely allocated (a root-logger context looks identical in the message alone).
  const bound: Record<string, unknown>[] = []
  const make = (bindings: Record<string, unknown>): Logger => ({
    info: () => {}, debug: () => {},
    warn: (m: string) => { warnings.push(m); bound.push(bindings) },
    error: (m: string) => { errors.push(m); bound.push(bindings) },
    child: (extra) => make({ ...bindings, ...extra }),
  })
  const admission = createAdmissionChain({
    inhibitors, brokenEnforcing, logger: make({}),
    membership: { members: () => Promise.resolve(null), requireCapability: () => {} },
    rhiza: () => <T,>() => ({}) as T,
    channelScopes: () => scopes,
  })
  return { admission, warnings, errors, bound }
}

const messageOn = (channel: string): IncomingMessage => ({ ...message, channel })

describe('createAdmissionChain', () => {
  it('admits when there is no inhibitor at all', async () => {
    expect(await chain([]).admission.admit(message)).toEqual({ allow: true })
  })

  it('admits when every inhibitor allows', async () => {
    const { admission } = chain([
      inhibitor('a', false, () => Promise.resolve({ allow: true })),
      inhibitor('b', true, () => Promise.resolve({ allow: true })),
    ])
    expect(await admission.admit(message)).toEqual({ allow: true })
  })

  it('refuses on the first refusal and reports its reason', async () => {
    const { admission } = chain([
      inhibitor('a', false, () => Promise.resolve({ allow: false, reason: 'not a member' })),
    ])
    expect(await admission.admit(message)).toEqual({ allow: false, reason: 'not a member' })
  })

  it('honours an advisory refusal exactly as an enforcing one', async () => {
    const { admission } = chain([inhibitor('a', false, () => Promise.resolve({ allow: false, reason: 'no' }))])
    expect((await admission.admit(message)).allow).toBe(false)
  })

  it('short-circuits, so a later inhibitor is never asked', async () => {
    let asked = false
    const { admission } = chain([
      inhibitor('a', false, () => Promise.resolve({ allow: false, reason: 'no' })),
      inhibitor('z', false, () => { asked = true; return Promise.resolve({ allow: true }) }),
    ])
    await admission.admit(message)
    expect(asked).toBe(false)
  })

  it('asks in alphabetical order, not in registry order', async () => {
    const order: string[] = []
    const { admission } = chain([
      inhibitor('zulu', false, () => { order.push('zulu'); return Promise.resolve({ allow: true }) }),
      inhibitor('alpha', false, () => { order.push('alpha'); return Promise.resolve({ allow: true }) }),
    ])
    await admission.admit(message)
    expect(order).toEqual(['alpha', 'zulu'])
  })

  it('skips an advisory inhibitor that throws, with a warning', async () => {
    const { admission, warnings } = chain([
      inhibitor('a', false, () => Promise.reject(new Error('boom'))),
    ])
    expect(await admission.admit(message)).toEqual({ allow: true })
    expect(warnings.join(' ')).toContain('boom')
  })

  it('refuses everything when an enforcing inhibitor throws', async () => {
    const { admission, errors } = chain([
      inhibitor('a', true, () => Promise.reject(new Error('boom'))),
    ])
    const verdict = await admission.admit(message)
    expect(verdict.allow).toBe(false)
    expect(errors.join(' ')).toContain('boom')
  })

  it('refuses everything when an enforcing inhibitor never started', async () => {
    const { admission } = chain([], ['gate'])
    expect((await admission.admit(message)).allow).toBe(false)
  })

  it("attributes an inhibitor's own records to it during inspect(), as start() already does", async () => {
    const logging = inhibitor('gate', false, () => Promise.resolve({ allow: true }))
    ;(logging.instance as { inspect: unknown }).inspect = (_m: IncomingMessage, ctx: InhibitorContext) => {
      ctx.logger.warn('looked up the group')
      return Promise.resolve({ allow: true })
    }
    const { admission, bound } = chain([logging])
    await admission.admit(message)
    expect(bound).toEqual([{ inhibitor: 'gate' }])
  })

  // `allow` comes from plugin code, so it is not necessarily a boolean. `{ allow: 'no' }`
  // is truthy, and a bare !verdict.allow used to admit it — even under `enforcing`.
  describe('a verdict whose allow is not a boolean', () => {
    const malformed = (name: string, enforcing: boolean, value: unknown): GerminatedInhibitor =>
      inhibitor(name, enforcing, () => Promise.resolve({ allow: value } as unknown as Verdict))

    it('refuses all traffic when the inhibitor is enforcing', async () => {
      const { admission, errors } = chain([malformed('a', true, 'no')])
      const verdict = await admission.admit(message)
      expect(verdict.allow).toBe(false)
      expect(verdict.allow ? '' : verdict.reason).toContain("no boolean 'allow'")
      expect(errors.join(' ')).toContain("no boolean 'allow'")
    })

    it('skips an advisory inhibitor with a warning rather than trusting it', async () => {
      const { admission, warnings } = chain([malformed('a', false, 'no')])
      expect(await admission.admit(message)).toEqual({ allow: true })
      expect(warnings.join(' ')).toContain("no boolean 'allow'")
    })

    it('rejects a missing allow, and an absent verdict, the same way', async () => {
      expect((await chain([malformed('a', true, undefined)]).admission.admit(message)).allow).toBe(false)
      const absent = inhibitor('a', true, () => Promise.resolve(null as unknown as Verdict))
      expect((await chain([absent]).admission.admit(message)).allow).toBe(false)
    })
  })
})

describe('inhibitor channel confinement', () => {
  it('skips an inhibitor on a channel it is not confined to, and runs it on one it is', async () => {
    const seen: string[] = []
    const gate = inhibitor('gate', false, () => {
      seen.push('asked')
      return Promise.resolve({ allow: false, reason: 'no' })
    })
    const { admission } = chain([gate], [], new Map([['gate', ['signal']]]))
    expect(await admission.admit(messageOn('console'))).toEqual({ allow: true })
    expect(seen).toEqual([])
    expect((await admission.admit(messageOn('signal'))).allow).toBe(false)
    expect(seen).toEqual(['asked'])
  })

  it('runs an unconfined inhibitor on every channel', async () => {
    const gate = inhibitor('gate', false, () => Promise.resolve({ allow: false, reason: 'no' }))
    const { admission } = chain([gate])
    expect((await admission.admit(messageOn('console'))).allow).toBe(false)
    expect((await admission.admit(messageOn('signal'))).allow).toBe(false)
  })

  it('treats an explicit empty channel list the same as no entry at all', async () => {
    const gate = inhibitor('gate', false, () => Promise.resolve({ allow: false, reason: 'no' }))
    const { admission } = chain([gate], [], new Map([['gate', []]]))
    expect((await admission.admit(messageOn('console'))).allow).toBe(false)
    expect((await admission.admit(messageOn('signal'))).allow).toBe(false)
  })

  it('confines a broken enforcing inhibitor refusal to its own channels', async () => {
    const { admission } = chain([], ['gate'], new Map([['gate', ['signal']]]))
    expect(await admission.admit(messageOn('console'))).toEqual({ allow: true })
    expect((await admission.admit(messageOn('signal'))).allow).toBe(false)
  })

  it('still refuses every channel for a broken enforcing inhibitor that is unconfined', async () => {
    const { admission } = chain([], ['gate'])
    expect((await admission.admit(messageOn('console'))).allow).toBe(false)
    expect((await admission.admit(messageOn('signal'))).allow).toBe(false)
  })
})

// This is the phase's authorization boundary for inhibitors, and it had no test of its
// own: chain.test.ts stubbed rhiza() out and the only fixture exercising it starts empty.
describe('createInhibitorContext', () => {
  const rhizaNamed = (name: string, api: object): GerminatedRhiza => ({
    name, config: {},
    manifest: { kind: 'rhiza', name, septum: '^0.5' },
    instance: { api },
  } as unknown as GerminatedRhiza)

  function context(options: {
    resolved: string[]
    scopes?: string[]
    rhizas?: GerminatedRhiza[]
    onMycelium?: (scopes: readonly string[]) => void
  }) {
    const inhibitor = {
      name: 'gate', config: {},
      resolved: new Set(options.resolved),
      scopes: options.scopes ?? [],
      manifest: { kind: 'inhibitor', name: 'gate', septum: '^0.5', enforcing: true },
      instance: { inspect: () => Promise.resolve({ allow: true }) },
    } as unknown as GerminatedInhibitor
    return createInhibitorContext({
      inhibitor,
      membership: { members: () => Promise.resolve(null), requireCapability: () => {} },
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, child: () => ({}) } as unknown as Logger,
      rhizas: options.rhizas ?? [],
      mycelium: (scopes) => { options.onMycelium?.(scopes); return { scoped: scopes } },
    })
  }

  it("refuses a rhiza the inhibitor's requires never declared", () => {
    const ctx = context({ resolved: [] })
    expect(() => ctx.rhiza('radarr')).toThrow(/'radarr'.*not declared/)
  })

  it('distinguishes a declared rhiza that failed to start from an undeclared one', () => {
    const ctx = context({ resolved: ['radarr'], rhizas: [] })
    expect(() => ctx.rhiza('radarr')).toThrow(/resolved but failed to start/)
  })

  it('returns a started rhiza its own api object', () => {
    const api = { search: () => 'dune' }
    const ctx = context({ resolved: ['radarr'], rhizas: [rhizaNamed('radarr', api)] })
    expect(ctx.rhiza<object>('radarr')).toBe(api)
  })

  it("routes mycelium through the scope-gated api, with this inhibitor's own scopes", () => {
    const seen: (readonly string[])[] = []
    const ctx = context({
      resolved: ['mycelium'],
      scopes: ['principals.read'],
      onMycelium: (scopes) => { seen.push(scopes) },
    })
    expect(ctx.rhiza<object>('mycelium')).toEqual({ scoped: ['principals.read'] })
    expect(seen).toEqual([['principals.read']])
  })

  it('refuses mycelium when it was never required, rather than mounting an empty api', () => {
    const ctx = context({ resolved: [], scopes: ['principals.read'] })
    expect(() => ctx.rhiza('mycelium')).toThrow(/not declared/)
  })

  it('answers has() from the resolved set alone', () => {
    const ctx = context({ resolved: ['radarr'] })
    expect(ctx.has('radarr')).toBe(true)
    expect(ctx.has('sonarr')).toBe(false)
  })
})
