import { describe, expect, it } from 'bun:test'
import type { IncomingMessage, Verdict } from '@mycelo/septum'
import { createAdmissionChain } from '../../src/admission/chain.js'
import type { GerminatedInhibitor } from '../../src/germination/registry.js'

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

function chain(inhibitors: readonly GerminatedInhibitor[], brokenEnforcing: string[] = []) {
  const warnings: string[] = []
  const errors: string[] = []
  const logger = {
    info: () => {}, debug: () => {},
    warn: (m: string) => { warnings.push(m) },
    error: (m: string) => { errors.push(m) },
    child: () => logger,
  } as unknown as Parameters<typeof createAdmissionChain>[0]['logger']
  const admission = createAdmissionChain({
    inhibitors, brokenEnforcing, logger,
    membership: { members: () => Promise.resolve(null), requireCapability: () => {} },
    rhiza: () => <T,>() => ({}) as T,
  })
  return { admission, warnings, errors }
}

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

  it('ignores a dormant advisory inhibitor', async () => {
    expect((await chain([], []).admission.admit(message)).allow).toBe(true)
  })
})
