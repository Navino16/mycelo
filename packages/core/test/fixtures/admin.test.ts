import { expect, it } from 'bun:test'
import type { EnzymeContext, Invocation } from '@mycelo/septum'
import module from '../../../../fixtures/admin/src/index.js'

function invocation(args: Record<string, string>): Invocation {
  return { command: 'x', args, rest: '', message: {} as Invocation['message'] }
}

function stubContext(mycelium: object, replies: string[]): EnzymeContext {
  return {
    rhiza: <T>() => mycelium as T,
    reply: (c: { text?: string }) => {
      if (c.text !== undefined) replies.push(c.text)
      return Promise.resolve()
    },
  } as unknown as EnzymeContext
}

it('plugin-set stores a bare number as a number and a bare word as a string', async () => {
  const written: Array<[string, string, unknown]> = []
  const ctx = stubContext(
    { setSetting: (n: string, k: string, v: unknown) => { written.push([n, k, v]); return Promise.resolve() } },
    [],
  )
  const handlers = module.create().handlers
  await handlers['handlePluginSet']?.(invocation({ name: 'radarr', key: 'port', value: '8080' }), ctx)
  await handlers['handlePluginSet']?.(invocation({ name: 'radarr', key: 'url', value: 'http://x' }), ctx)
  // 8080 as a number, http://x as a string: a chat channel has no types and Zod has both.
  expect(written[0]).toEqual(['radarr', 'port', 8080])
  expect(written[1]).toEqual(['radarr', 'url', 'http://x'])
})

it('plugin-enable reports the refusal reason verbatim', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { enable: () => Promise.reject(new Error('configuration is incomplete: url')) },
    replies,
  )
  await module.create().handlers['handlePluginEnable']?.(invocation({ name: 'needs-config' }), ctx)
  // Verbatim, not merely "contains": a swallowed or truncated reason leaves the operator
  // with nothing to act on.
  expect(replies[0]).toBe('configuration is incomplete: url')
})

it('plugin-disable reports success', async () => {
  const replies: string[] = []
  const disabled: string[] = []
  const ctx = stubContext(
    { disable: (n: string) => { disabled.push(n); return Promise.resolve() } },
    replies,
  )
  await module.create().handlers['handlePluginDisable']?.(invocation({ name: 'radarr' }), ctx)
  expect(disabled).toEqual(['radarr'])
  expect(replies[0]).toBe('disabled radarr')
})

it('plugin-disable reports the refusal reason verbatim, not "command failed"', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { disable: () => Promise.reject(new Error("plugin 'ghost' is not installed")) },
    replies,
  )
  await module.create().handlers['handlePluginDisable']?.(invocation({ name: 'ghost' }), ctx)
  expect(replies[0]).toBe("plugin 'ghost' is not installed")
})

it('plugin-set reports the refusal reason verbatim, not "command failed"', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { setSetting: () => Promise.reject(new Error("plugin 'ghost' is not installed")) },
    replies,
  )
  await module.create().handlers['handlePluginSet']?.(invocation({ name: 'ghost', key: 'x', value: '1' }), ctx)
  expect(replies[0]).toBe("plugin 'ghost' is not installed")
})

it('plugin-list reports each plugin\'s kind and state, including a disabled plugin', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    {
      listPlugins: () => [
        { name: 'radarr', kind: 'rhiza', commands: [], state: 'germinated', enabled: true },
        { name: 'broken', commands: [], state: 'dormant', reason: 'manifest did not parse', enabled: true },
        { name: 'sonarr', kind: 'rhiza', commands: [], state: 'disabled', enabled: false },
      ],
    },
    replies,
  )
  await module.create().handlers['handlePluginList']?.(invocation({}), ctx)
  expect(replies[0]).toContain('radarr (rhiza) — germinated')
  expect(replies[0]).toContain('broken (unknown) — dormant')
  expect(replies[0]).toContain('sonarr (rhiza) — disabled')
})

it('plugin-config reports no settings when there are none', async () => {
  const replies: string[] = []
  const ctx = stubContext({ settings: () => Promise.resolve({}) }, replies)
  await module.create().handlers['handlePluginConfig']?.(invocation({ name: 'radarr' }), ctx)
  expect(replies[0]).toBe('no settings')
})

it('plugin-config lists settings, secrets already redacted by the mycelium', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { settings: () => Promise.resolve({ url: 'http://x', apiKey: '••••' }) },
    replies,
  )
  await module.create().handlers['handlePluginConfig']?.(invocation({ name: 'radarr' }), ctx)
  expect(replies[0]).toBe('url = http://x\napiKey = ••••')
})
