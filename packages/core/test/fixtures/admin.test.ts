import { expect, it } from 'bun:test'
import type { EnzymeContext, Invocation, Translate } from '@mycelo/septum'
import module from '../../../../fixtures/admin/src/index.js'

function invocation(args: Record<string, string>, message: Partial<Invocation['message']> = {}): Invocation {
  return { command: 'x', args, rest: '', message: message as Invocation['message'] }
}

// Mirrors fixtures/admin/translations/{en,fr}.yaml, so a test asserting on rendered
// text is asserting against the same strings the shipped catalogues carry.
const LANG_CATALOG: Record<string, Record<string, string>> = {
  en: {
    'lang.usage': 'usage: lang <locale>',
    'lang.usage-group': 'usage: lang-group <locale>',
    'lang.set': 'your language is now {locale}',
    'lang.set-group': 'this conversation now answers in {locale}',
    'lang.group-only': 'lang-group only makes sense in a group',
  },
  fr: {
    'lang.usage': 'usage : lang <locale>',
    'lang.usage-group': 'usage : lang-group <locale>',
    'lang.set': 'votre langue est désormais {locale}',
    'lang.set-group': 'cette conversation répond désormais en {locale}',
    'lang.group-only': "lang-group n'a de sens qu'en groupe",
  },
}

function stubT(): Translate {
  return ((key: string, params?: Record<string, unknown>, locale = 'en') => {
    const template = LANG_CATALOG[locale]?.[key] ?? LANG_CATALOG['en']?.[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params?.[name] as string | number | undefined
      return value === undefined ? `{${name}}` : String(value)
    })
  }) as Translate
}

function stubContext(
  mycelium: object,
  replies: string[],
  extra: { t?: Translate; principal?: { id: string } } = {},
): EnzymeContext {
  return {
    rhiza: <T>() => mycelium as T,
    reply: (c: { text?: string }) => {
      if (c.text !== undefined) replies.push(c.text)
      return Promise.resolve()
    },
    t: extra.t ?? ((key: string) => key),
    principal: extra.principal ?? { id: 'alice' },
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

// settings() now rejects for an uninstalled plugin, so the one handler with no catch
// would answer "command 'plugin-config' failed" instead of naming the plugin.
it('plugin-config reports the refusal reason verbatim, not "command failed"', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { settings: () => Promise.reject(new Error("plugin 'ghost' is not installed")) },
    replies,
  )
  await module.create().handlers['handlePluginConfig']?.(invocation({ name: 'ghost' }), ctx)
  expect(replies[0]).toBe("plugin 'ghost' is not installed")
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

it('sets the sender\'s own locale and confirms in the new language', async () => {
  const replies: string[] = []
  const written: Array<[string, string]> = []
  const ctx = stubContext(
    {
      setPrincipalLocale: (id: string, locale: string) => {
        written.push([id, locale])
        return Promise.resolve()
      },
    },
    replies,
    { t: stubT(), principal: { id: 'alice' } },
  )
  await module.create().handlers['handleLang']?.(invocation({ locale: 'fr' }), ctx)
  expect(written).toEqual([['alice', 'fr']])
  // Explicit locale, not the one resolved for this message: the confirmation must speak
  // the language just chosen, not the one just abandoned.
  expect(replies).toEqual(['votre langue est désormais fr'])
})

it('refuses a locale no catalogue provides, naming what is available', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { setPrincipalLocale: () => Promise.reject(new Error("no catalogue provides 'de'; available: en, fr")) },
    replies,
    { t: stubT(), principal: { id: 'alice' } },
  )
  await module.create().handlers['handleLang']?.(invocation({ locale: 'de' }), ctx)
  expect(replies[0]).toContain('available: en, fr')
})

it('refuses an invalid tag without touching the stored locale', async () => {
  const replies: string[] = []
  const ctx = stubContext(
    { setPrincipalLocale: () => Promise.reject(new Error("'not-a-tag' is not a locale tag")) },
    replies,
    { t: stubT(), principal: { id: 'alice' } },
  )
  await module.create().handlers['handleLang']?.(invocation({ locale: 'not-a-tag' }), ctx)
  expect(replies).toEqual(["'not-a-tag' is not a locale tag"])
})

it('sets the conversation locale from within a group', async () => {
  const replies: string[] = []
  const written: Array<[string, string, string]> = []
  const ctx = stubContext(
    {
      setConversationLocale: (channel: string, conversationId: string, locale: string) => {
        written.push([channel, conversationId, locale])
        return Promise.resolve()
      },
    },
    replies,
    { t: stubT() },
  )
  await module.create().handlers['handleLangGroup']?.(
    invocation({ locale: 'fr' }, { channel: 'console', conversationId: 'g1', group: { id: 'g1' } }),
    ctx,
  )
  expect(written).toEqual([['console', 'g1', 'fr']])
  expect(replies).toEqual(['cette conversation répond désormais en fr'])
})

it('refuses /lang-group in a direct message', async () => {
  const replies: string[] = []
  const written: unknown[] = []
  const ctx = stubContext(
    {
      setConversationLocale: (...args: unknown[]) => {
        written.push(args)
        return Promise.resolve()
      },
    },
    replies,
    { t: stubT() },
  )
  // Design §4's "by construction" claim is this check, not the operator's context rule.
  await module.create().handlers['handleLangGroup']?.(
    invocation({ locale: 'fr' }, { channel: 'console', conversationId: 'alice-dm' }),
    ctx,
  )
  expect(replies[0]).toContain('group')
  expect(written).toEqual([])
})
