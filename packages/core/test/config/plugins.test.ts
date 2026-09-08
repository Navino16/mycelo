import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import type { Logger } from '@mycelo/septum'
import { readSettings, recordInstall, writeSetting } from '../../src/config/store.js'
import {
  listPlugins, redactSecrets, rejectedSettings, undeclaredSecretsRefusal,
  writeDeclaredSetting,
} from '../../src/config/plugins.js'
import { REDACTED } from '../../src/support/redaction.js'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import type { Registry } from '../../src/germination/registry.js'
import { addSource, listSources, seedOfficialSource } from '../../src/sporangium/sources.js'
import { describeConfigError } from '../../src/support/thrown.js'
import { emptyRegistry } from '../support/registry.js'
import { loadCoreCatalogs } from '../../src/i18n/core-catalogs.js'
import { renderRefusal } from '../../src/i18n/refusal.js'
import { createTranslator } from '../../src/i18n/translator.js'

const SPORES = [resolve(import.meta.dirname, '../../../../fixtures')]

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => silent }
const translator = createTranslator({ defaultLocale: 'en', logger: silent, catalogs: loadCoreCatalogs() })

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-config-plugins-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// 9.6A's milestone, concern H: `/plugin-set` stored `gate.channel = ''` and answered
// `set channel on gate`. An enforcing inhibitor with an empty channel is dormant at the next
// boot, which refuses all traffic on every channel. Declared is not valid (spec §8).
it('refuses a declared key whose value the plugin\'s own schema rejects, and writes nothing', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'gate', 'inhibitor')
  const result = await writeDeclaredSetting(db, SPORES, 'gate', 'channel', '')
  expect(result.ok).toBe(false)
  expect(readSettings(db, 'gate')).toEqual({})
  const refusal = result.ok ? undefined : result.refusal
  expect(refusal === undefined ? '' : renderRefusal(translator, refusal, 'en'))
    .toBe("configuration is incomplete: channel: gate config needs a non-empty 'channel'")
  close()
})

it('writes a declared key whose value the schema accepts', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'gate', 'inhibitor')
  expect(await writeDeclaredSetting(db, SPORES, 'gate', 'channel', 'signal')).toEqual({ ok: true })
  expect(readSettings(db, 'gate')).toEqual({ channel: 'signal' })
  close()
})

// Two required fields, neither defaulted — unlike fixtures/gate, which defaults every field it
// is not given and so can never report an issue on a key other than the one just written.
// `rejectedSettingRefs` parses `{[key]: value}` against the whole schema, so this is the fixture
// that can show a real Zod-shaped schema reporting the *other* required key as missing (spec §8).
function twoRequired(): void {
  mkdirSync(join(dir, 'twofield', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'twofield', 'spore.yaml'),
    'kind: enzyme\nname: twofield\nseptum: "^0.12"\n'
      + 'commands:\n  - name: twofield\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'twofield', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: (input) => {\n'
      + '      const issues = []\n'
      + '      if (typeof input?.url !== "string" || input.url.length === 0) {\n'
      + '        issues.push({ path: ["url"], message: "twofield config needs a non-empty \'url\'" })\n'
      + '      }\n'
      + '      if (typeof input?.token !== "string" || input.token.length === 0) {\n'
      + '        issues.push({ path: ["token"], message: "twofield config needs a non-empty \'token\'" })\n'
      + '      }\n'
      + '      return issues.length > 0\n'
      + '        ? { success: false, error: { issues } }\n'
      + '        : { success: true, data: input }\n'
      + '    },\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

// spec §8: "never the merged object — a two-required-field form must be fillable one field at a
// time". Without the per-key filter this refuses on the unset `token`, and `url` becomes
// impossible to set while `token` is empty (review, Important 2).
it('writes one required key even though the other required key is still unset', async () => {
  const { db, close } = fresh()
  twoRequired()
  recordInstall(db, 'twofield', 'enzyme')
  expect(await writeDeclaredSetting(db, [dir], 'twofield', 'url', 'http://x')).toEqual({ ok: true })
  expect(readSettings(db, 'twofield')).toEqual({ url: 'http://x' })
  close()
})

it('refuses a rejected key, naming only that key and not the other unset one', async () => {
  const { db, close } = fresh()
  twoRequired()
  recordInstall(db, 'twofield', 'enzyme')
  const result = await writeDeclaredSetting(db, [dir], 'twofield', 'url', '')
  expect(result.ok).toBe(false)
  expect(readSettings(db, 'twofield')).toEqual({})
  const refusal = result.ok ? undefined : result.refusal
  expect(refusal === undefined ? '' : renderRefusal(translator, refusal, 'en'))
    .toBe("configuration is incomplete: url: twofield config needs a non-empty 'url'")
  close()
})

// design §5.2's own worked example: fixtures/gate's error was a bare string, so
// objectRejections' `member(result.error, 'issues')` found nothing and the value passed
// through unvalidated. This is the defect ConfigError's guaranteed shape closes.
it('a rejected value is reported once the schema carries a declared issue', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'gate', 'inhibitor')
  const rejected = await rejectedSettings(db, SPORES, 'gate', { channel: '' }, translator, 'en')
  expect(rejected).toEqual([{ key: 'channel', messages: ["gate config needs a non-empty 'channel'"] }])
  close()
})

// Named for what it refuses, not for a real spore: a fixture called `plex` would read as that
// published rhiza. Its messageKey is a ref, shaped the way septum's toConfigIssue builds one for
// a mapped `too_small` issue (config.ts:69).
function minPort(): void {
  mkdirSync(join(dir, 'minport', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'minport', 'spore.yaml'),
    'kind: enzyme\nname: minport\nseptum: "^0.12"\n'
      + 'commands:\n  - name: minport\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'minport', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: (input) => (typeof input?.port === "number" && input.port >= 1\n'
      + '      ? { success: true, data: input }\n'
      + '      : { success: false, error: { issues: [{\n'
      + '          path: ["port"], message: "port must be at least 1",\n'
      + '          messageKey: { domain: "common", key: "refusal.config.tooSmall" },\n'
      + '          params: { origin: "number", minimum: 1 },\n'
      + '        }] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('a rejection carries rendered sentences, not the plugin\'s issue objects', async () => {
  const { db, close } = fresh()
  minPort()
  recordInstall(db, 'minport', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'minport', { port: 0 }, translator, 'fr')
  expect(rejected).toEqual([{ key: 'port', messages: ['doit valoir au moins 1'] }])
  close()
})

it('undeclaredSecretsRefusal carries the count its plural needs', () => {
  expect(undeclaredSecretsRefusal(['token'])).toEqual({
    domain: 'common',
    key: 'refusal.config.undeclaredSecrets',
    params: { count: 1, keys: ["'token'"] },
  })
  // The plural case: a count the message's `one` branch does not match.
  expect(undeclaredSecretsRefusal(['a', 'b']).params?.['count']).toBe(2)
})

// Both counts: the plural halves of an ICU `{count, plural, ...}` drift alone, and this is the
// only place either branch is rendered against the English it is supposed to read as.
it('renders both counts of the undeclared-secret verdict', () => {
  expect(renderRefusal(translator, undeclaredSecretsRefusal(['token']), 'en'))
    .toBe("configuration declares a secret 'token' the schema does not have")
  expect(renderRefusal(translator, undeclaredSecretsRefusal(['a', 'b']), 'en'))
    .toBe("configuration declares secrets 'a', 'b' the schema does not have")
})

// Installed under a real catalogue domain's own name, so a bare-string messageKey resolves
// through the shipped `common` catalogue instead of falling back — the only way to pin that
// rejectedSettings threads its `name` argument into renderConfigIssue's `domain` parameter.
function ownDomainName(): void {
  mkdirSync(join(dir, 'common', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'common', 'spore.yaml'),
    'kind: enzyme\nname: common\nseptum: "^0.12"\n'
      + 'commands:\n  - name: common\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'common', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: () => ({ success: false, error: { issues: [{\n'
      + '      path: ["address"], message: "not a valid email",\n'
      + '      messageKey: "refusal.config.invalidFormat",\n'
      + '      params: { format: "email" },\n'
      + '    }] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('renders a bare-string messageKey through the plugin name as domain', async () => {
  const { db, close } = fresh()
  ownDomainName()
  recordInstall(db, 'common', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'common', { address: 'x' }, translator, 'fr')
  expect(rejected).toEqual([{ key: 'address', messages: ["n'est pas un email valide"] }])
  close()
})

// Duck-typed like the fixtures in lifecycle.test.ts: a spore in a temporary directory
// cannot resolve the workspace's zod, and a real one carries its own copy anyway.
function handwritten(): void {
  mkdirSync(join(dir, 'handwritten', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'handwritten', 'spore.yaml'),
    'kind: enzyme\nname: handwritten\nseptum: "^0.12"\n'
      + 'commands:\n  - name: handwritten\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'handwritten', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: (input) => (typeof input?.port === "number"\n'
      + '      ? { success: true, data: input }\n'
      + '      : { success: false, error: { issues: [{ path: ["port"], message: "expected a number" }] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

// No `shape`: pins that the whole-object fallback alone is now the mechanism, with no
// duck-typed per-field branch left to fall back on.
it('a hand-written ConfigSchema with no shape still gets per-value validation', async () => {
  const { db, close } = fresh()
  handwritten()
  recordInstall(db, 'handwritten', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'handwritten', { port: 'nope' }, translator, 'en')
  expect(rejected).toEqual([{ key: 'port', messages: ['expected a number'] }])
  close()
})

// septum documents ConfigIssue.path as empty for a whole-object refusal and the kit
// certifies one, but the per-key filter dropped it — a top-level .refine() was accepted
// with 200 (review, Important 1). Two keys, because a whole-object refusal concerns them all.
function eitherOr(): void {
  mkdirSync(join(dir, 'eitheror', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'eitheror', 'spore.yaml'),
    'kind: enzyme\nname: eitheror\nseptum: "^0.12"\n'
      + 'commands:\n  - name: eitheror\n    description: command.eitheror.description\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'eitheror', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: (input) => (input?.socket === undefined || input?.tcp === undefined\n'
      + '      ? { success: true, data: input }\n'
      + '      : { success: false, error: { issues: [{ path: [], message: "socket or tcp, not both" }] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('reports a whole-object refusal against every key the request carried', async () => {
  const { db, close } = fresh()
  eitherOr()
  recordInstall(db, 'eitheror', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'eitheror', { socket: '/tmp/s', tcp: '1:2' }, translator, 'en')
  expect(rejected).toEqual([
    { key: 'socket', messages: ['socket or tcp, not both'] },
    { key: 'tcp', messages: ['socket or tcp, not both'] },
  ])
  close()
})

it('leaves a partial write accepted when the whole-object rule it would break is not triggered', async () => {
  const { db, close } = fresh()
  eitherOr()
  recordInstall(db, 'eitheror', 'enzyme')
  expect(await rejectedSettings(db, [dir], 'eitheror', { socket: '/tmp/s' }, translator, 'en')).toEqual([])
  close()
})

// A pre-0.8 plugin can emit an issue with no path at all. support/thrown.ts renders it as a
// whole-object refusal, so enablePlugin reports it — while this reader dropped it and PUT
// answered 200. One value, two duck-typed readers, opposite verdicts (re-review, minor 3).
function pathless(): void {
  mkdirSync(join(dir, 'pathless', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'pathless', 'spore.yaml'),
    'kind: enzyme\nname: pathless\nseptum: "^0.12"\n'
      + 'commands:\n  - name: pathless\n    description: command.pathless.description\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'pathless', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    safeParse: () => ({ success: false, error: { issues: [\n'
      + '      { message: "the whole thing is wrong" },\n'
      + '      { path: "notanarray", message: "so is this" },\n'
      + '    ] } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('reads an issue with no usable path the way enablePlugin does, against every key given', async () => {
  const { db, close } = fresh()
  pathless()
  recordInstall(db, 'pathless', 'enzyme')
  const rejected = await rejectedSettings(db, [dir], 'pathless', { a: 1, b: 2 }, translator, 'en')
  const messages = ['the whole thing is wrong', 'so is this']
  expect(rejected).toEqual([{ key: 'a', messages }, { key: 'b', messages }])
  // The same two issues through the other reader, which has always treated them this way.
  const issues = [
    { message: 'the whole thing is wrong' },
    { path: 'notanarray', message: 'so is this' },
  ]
  expect(describeConfigError({ issues })).toBe('the whole thing is wrong; so is this')
  close()
})

// Every other secret test hand-rolls its configSchema, because a /tmp spore cannot resolve zod.
// This is the only place a real `defineConfig(schema, { secrets })` product meets the core's
// reader, so it is what pins the fixture's declaration and septum's plumbing of it.
it('the vault fixture\'s declared secret is redacted, and its other setting is not', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, SPORES, 'vault', 'token', 's3cr3t')
  await writeDeclaredSetting(db, SPORES, 'vault', 'url', 'http://home')
  expect(redactSecrets(db, 'vault')).toEqual({ token: REDACTED, url: 'http://home' })
  expect(readSettings(db, 'vault')).toEqual({ token: 's3cr3t', url: 'http://home' })
  close()
})

// Duck-typed like handwritten(): a spore under /tmp cannot resolve the workspace's zod.
// `secrets` is a plain array literal, exactly what a plugin's own bundled septum would emit.
function vault(): void {
  mkdirSync(join(dir, 'vault', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'vault', 'spore.yaml'),
    'kind: enzyme\nname: vault\nseptum: "^0.12"\n'
      + 'commands:\n  - name: vault\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'vault', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    secrets: [\'token\'],\n'
      + '    safeParse: (input) => ({ success: true, data: input }),\n'
      + '    toJsonSchema: () => ({ properties: { url: {}, token: {} } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

// Two declared secrets: the cardinality case a single-secret fixture cannot exercise.
function twin(): void {
  mkdirSync(join(dir, 'twin', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'twin', 'spore.yaml'),
    'kind: enzyme\nname: twin\nseptum: "^0.12"\n'
      + 'commands:\n  - name: twin\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'twin', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    secrets: [\'token\', \'password\'],\n'
      + '    safeParse: (input) => ({ success: true, data: input }),\n'
      + '    toJsonSchema: () => ({ properties: { token: {}, password: {} } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('a declared secret is stored as secret and comes back redacted', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'vault', 'token', 's3cr3t')
  expect(redactSecrets(db, 'vault')).toEqual({ token: REDACTED })
  close()
})

it('a key the plugin does not declare secret comes back in the clear', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'vault', 'url', 'http://example')
  expect(redactSecrets(db, 'vault')).toEqual({ url: 'http://example' })
  close()
})

it('both declared secrets are stored as secret, not only the last', async () => {
  const { db, close } = fresh()
  twin()
  recordInstall(db, 'twin', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'twin', 'token', 'a')
  await writeDeclaredSetting(db, [dir], 'twin', 'password', 'b')
  expect(redactSecrets(db, 'twin')).toEqual({ token: REDACTED, password: REDACTED })
  close()
})

// The ordinary upgrade path: v1 shipped `token` with no `secrets`, the operator configured it,
// v2 declares it. Without promotion no code path in the repository could ever mask that row.
it('a row written before the declaration is redacted once the plugin declares the key', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  writeSetting(db, 'vault', 'token', 'old-secret', false)
  await writeDeclaredSetting(db, [dir], 'vault', 'token', 's3cr3t')
  expect(redactSecrets(db, 'vault')).toEqual({ token: REDACTED })
  close()
})

// The other direction stays blocked: a key the plugin does not declare secret keeps a flag it
// already has, so a later version that forgets to say so cannot un-redact a credential.
it('a secret row stays secret on a key the plugin does not declare', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  writeSetting(db, 'vault', 'url', 'http://old', true)
  await writeDeclaredSetting(db, [dir], 'vault', 'url', 'http://new')
  expect(redactSecrets(db, 'vault')).toEqual({ url: REDACTED })
  close()
})

// KNOWN LIMITATION, ruled deliberate: the core reads `secrets` off the plugin's module, so a
// module that throws at import leaves it unreadable and the write is not refused — refusing it
// would remove the operator's only surface while fixing nothing config can fix. Documented in
// septum's README and on ConfigSchema.secrets. The recovery is the promotion test above: writing
// the value again, once the module loads, flags the row.
it('a value written while the plugin throws at import is stored in the clear (known limitation)', async () => {
  const { db, close } = fresh()
  mkdirSync(join(dir, 'boomvault', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'boomvault', 'spore.yaml'),
    'kind: enzyme\nname: boomvault\nseptum: "^0.12"\n'
      + 'commands:\n  - name: boomvault\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(join(dir, 'boomvault', 'src/index.ts'), 'throw new Error("import explodes")\n', 'utf8')
  recordInstall(db, 'boomvault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'boomvault', 'token', 's3cr3t')
  expect(redactSecrets(db, 'boomvault')).toEqual({ token: 's3cr3t' })
  close()
})

// An operator can type '••••' into /plugin-set, and a spore that reads settings() and writes
// back gets the mask from redactSecrets — so the channel path must refuse this too, not answer
// ok for a write it silently dropped (task 3's ruling on writeDeclaredSetting).
it('writing the mask back to a secret leaves the credential intact, and refuses rather than answering ok', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'vault', 'token', 's3cr3t')
  const result = await writeDeclaredSetting(db, [dir], 'vault', 'token', REDACTED)
  expect(result.ok).toBe(false)
  const refusal = result.ok ? undefined : result.refusal
  expect(refusal === undefined ? '' : renderRefusal(translator, refusal, 'en'))
    .toBe("plugin 'vault' setting 'token' was left unchanged: a masked secret cannot be written back")
  expect(readSettings(db, 'vault')).toEqual({ token: 's3cr3t' })
  close()
})

// Found on a running bot via `/plugin-set keep token ••••`: the mask is 4 characters, so a
// schema requiring a longer secret refused it as incomplete before rewriteSetting was ever
// reached, and the operator was told their configuration was wrong when nothing was.
function keepMinLength(): void {
  mkdirSync(join(dir, 'keep', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'keep', 'spore.yaml'),
    'kind: enzyme\nname: keep\nseptum: "^0.12"\n'
      + 'commands:\n  - name: keep\n    description: x\n    code: handleIt\n',
    'utf8',
  )
  writeFileSync(
    join(dir, 'keep', 'src/index.ts'),
    'export default {\n'
      + '  configSchema: {\n'
      + '    secrets: [\'token\'],\n'
      + '    safeParse: (input) => (typeof input?.token === \'string\' && input.token.length >= 8)\n'
      + '      ? { success: true, data: input }\n'
      + '      : { success: false, error: { issues: [{ path: [\'token\'], message: \'too short\' }] } },\n'
      + '    toJsonSchema: () => ({ properties: { token: { type: \'string\', minLength: 8 } } }),\n'
      + '  },\n'
      + '  create: () => ({ handlers: { handleIt: async () => {} } }),\n'
      + '}\n',
    'utf8',
  )
}

it('a length-constrained secret set to the mask refuses as unchanged, not as incomplete', async () => {
  const { db, close } = fresh()
  keepMinLength()
  recordInstall(db, 'keep', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'keep', 'token', 'longenough')
  const result = await writeDeclaredSetting(db, [dir], 'keep', 'token', REDACTED)
  expect(result.ok).toBe(false)
  const refusal = result.ok ? undefined : result.refusal
  expect(refusal?.key).toBe('refusal.config.maskedSecretUnchanged')
  expect(refusal === undefined ? '' : renderRefusal(translator, refusal, 'en'))
    .toBe("plugin 'keep' setting 'token' was left unchanged: a masked secret cannot be written back")
  expect(readSettings(db, 'keep')).toEqual({ token: 'longenough' })
  close()
})

// The discriminating case: a guard keying off the string alone, not `isSecret`, would
// drop this write too and pass the other two tests.
it('the mask is an ordinary value on a key that is not secret', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'vault', 'url', REDACTED)
  expect(readSettings(db, 'vault')).toEqual({ url: REDACTED })
  close()
})

// Two installs, not one: with a single row the same label could be reported for every entry
// and the test would still pass (design §14.2 step 9).
it('an installed spore reports its source label and strain; a local one reports neither', () => {
  const { db, close } = fresh()
  seedOfficialSource(db)
  const source = listSources(db)[0]
  if (source === undefined) throw new Error('the official source was not seeded')
  recordInstall(db, 'radarr', 'rhiza', false, { sourceId: source.id, strain: '0.2.0' })
  recordInstall(db, 'admin', 'enzyme', false)
  const infos = listPlugins(emptyRegistry(), [], db)
  const radarr = infos.find((p) => p.name === 'radarr')
  expect(radarr?.source).toBe(source.label)
  expect(radarr?.strain).toBe('0.2.0')
  const admin = infos.find((p) => p.name === 'admin')
  expect(admin?.source).toBeUndefined()
  expect(admin?.strain).toBeUndefined()
  close()
})

// Two sources with different labels, and the two branches a reviewer skips because an install
// row reads as a disabled-plugin concern: a germinated spore and a dormant one.
it('carries provenance onto a germinated and a dormant entry, each from its own source', () => {
  const { db, close } = fresh()
  const official = addSource(db, { label: 'Mycelo spores', driver: 'github', location: 'https://example/a' })
  const third = addSource(db, { label: 'Someone else', driver: 'github', location: 'https://example/b' })
  recordInstall(db, 'media', 'enzyme', true, { sourceId: official.id, strain: '1.0.0' })
  recordInstall(db, 'broken', 'rhiza', true, { sourceId: third.id, strain: '2.3.4' })
  const registry = {
    ...emptyRegistry(),
    enzymes: [{ name: 'media', manifest: { kind: 'enzyme', name: 'media', septum: '^0.12', commands: [] } }],
    dormant: [{ name: 'broken', refusal: { domain: 'common', key: 'refusal.germination.rhizaNoApi' } }],
  } as unknown as Registry
  const infos = listPlugins(registry, [], db)
  const media = infos.find((p) => p.name === 'media')
  expect([media?.state, media?.source, media?.strain]).toEqual(['germinated', 'Mycelo spores', '1.0.0'])
  const broken = infos.find((p) => p.name === 'broken')
  expect([broken?.state, broken?.source, broken?.strain]).toEqual(['dormant', 'Someone else', '2.3.4'])
  close()
})

// A dormant spore whose manifest parsed once has its kind on the install row; without it the
// UI files the two commonest dormancies under "manifest did not parse" (plan defect 29).
it('gives a dormant entry the kind its install row recorded, and none when there is no row', () => {
  const { db, close } = fresh()
  recordInstall(db, 'plex', 'rhiza', true)
  const registry = {
    ...emptyRegistry(),
    dormant: [
      { name: 'plex', refusal: { domain: 'common', key: 'refusal.config.incomplete' } },
      { name: 'garbled', refusal: { domain: 'common', key: 'refusal.plugin.unreadableManifest' } },
    ],
  } as unknown as Registry
  const infos = listPlugins(registry, [], db)
  expect(infos.find((p) => p.name === 'plex')?.kind).toBe('rhiza')
  expect(infos.find((p) => p.name === 'garbled')?.kind).toBeUndefined()
  close()
})

it('carries the dormancy refusal through to PluginInfo', () => {
  const registry = {
    ...emptyRegistry(),
    dormant: [{
      name: 'broken',
      refusal: { domain: 'common', key: 'refusal.germination.inhibitorNoInspect' },
    }],
  } as unknown as Registry
  const info = listPlugins(registry, []).find((p) => p.name === 'broken')
  expect(info?.refusal).toEqual({ domain: 'common', key: 'refusal.germination.inhibitorNoInspect' })
})

// Correction 7's site: the row survives so the operator can recover it, and it is the one
// dormancy verdict `Dormant` never carries — the spore is not in the registry at all.
it('answers the notOnDisk refusal for an install row whose directory has gone', () => {
  const { db, close } = fresh()
  recordInstall(db, 'vanished', 'rhiza', true)
  const info = listPlugins(emptyRegistry(), [], db).find((p) => p.name === 'vanished')
  expect(info?.state).toBe('dormant')
  expect(info?.refusal).toEqual({
    domain: 'common', key: 'refusal.plugin.notOnDisk', params: { plugin: 'vanished' },
  })
  close()
})

// The other three germinated kinds. Both tests above use an enzyme, and dropping the spread
// from any one of hyphae, rhizas or inhibitors left the whole suite green — while design
// §14.2 step 9's own subject, `radarr`, is a rhiza.
it('carries provenance onto a germinated hypha, rhiza and inhibitor, each from its own source', () => {
  const { db, close } = fresh()
  const kinds = [
    ['signal', 'hypha', 'Sporangium A', '1.0.0'],
    ['radarr', 'rhiza', 'Sporangium B', '0.2.0'],
    ['group-gate', 'inhibitor', 'Sporangium C', '3.1.4'],
  ] as const
  const entries = kinds.map(([name, kind, label, strain]) => {
    const s = addSource(db, { label, driver: 'github', location: `https://example/${name}` })
    recordInstall(db, name, kind, true, { sourceId: s.id, strain })
    return { name, manifest: { kind, name, septum: '^0.12' } }
  })
  const registry = {
    ...emptyRegistry(),
    hyphae: [entries[0]], rhizas: [entries[1]], inhibitors: [entries[2]],
  } as unknown as Registry
  const infos = listPlugins(registry, [], db)
  expect(kinds.map(([name]) => {
    const info = infos.find((p) => p.name === name)
    return [info?.kind, info?.state, info?.source, info?.strain]
  })).toEqual([
    ['hypha', 'germinated', 'Sporangium A', '1.0.0'],
    ['rhiza', 'germinated', 'Sporangium B', '0.2.0'],
    ['inhibitor', 'germinated', 'Sporangium C', '3.1.4'],
  ])
  close()
})
