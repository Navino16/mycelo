import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { readSettings, recordInstall, writeSetting } from '../../src/config/store.js'
import { REDACTED, redactSecrets, rejectedSettings, writeDeclaredSetting } from '../../src/config/plugins.js'
import type { Db } from '../../src/persistence/db.js'
import { migrateDatabase, openDatabase } from '../../src/persistence/db.js'
import { describeConfigError } from '../../src/support/thrown.js'

const SPORES = [resolve(import.meta.dirname, '../../../../fixtures')]

function fresh(): { db: Db, close: () => void } {
  const p = openDatabase(':memory:')
  migrateDatabase(p.db)
  return p
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-config-plugins-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// design §5.2's own worked example: fixtures/gate's error was a bare string, so
// objectRejections' `member(result.error, 'issues')` found nothing and the value passed
// through unvalidated. This is the defect ConfigError's guaranteed shape closes.
it('a rejected value is reported once the schema carries a declared issue', async () => {
  const { db, close } = fresh()
  recordInstall(db, 'gate', 'inhibitor')
  const rejected = await rejectedSettings(db, SPORES, 'gate', { channel: '' })
  expect(rejected).toEqual([{ key: 'channel', issues: [{ path: ['channel'], message: "gate config needs a non-empty 'channel'" }] }])
  close()
})

// Duck-typed like the fixtures in lifecycle.test.ts: a spore in a temporary directory
// cannot resolve the workspace's zod, and a real one carries its own copy anyway.
function handwritten(): void {
  mkdirSync(join(dir, 'handwritten', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'handwritten', 'spore.yaml'),
    'kind: enzyme\nname: handwritten\nseptum: "^0.8"\n'
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
  const rejected = await rejectedSettings(db, [dir], 'handwritten', { port: 'nope' })
  expect(rejected).toEqual([{ key: 'port', issues: [{ path: ['port'], message: 'expected a number' }] }])
  close()
})

// septum documents ConfigIssue.path as empty for a whole-object refusal and the kit
// certifies one, but the per-key filter dropped it — a top-level .refine() was accepted
// with 200 (review, Important 1). Two keys, because a whole-object refusal concerns them all.
function eitherOr(): void {
  mkdirSync(join(dir, 'eitheror', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'eitheror', 'spore.yaml'),
    'kind: enzyme\nname: eitheror\nseptum: "^0.8"\n'
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
  const rejected = await rejectedSettings(db, [dir], 'eitheror', { socket: '/tmp/s', tcp: '1:2' })
  expect(rejected).toEqual([
    { key: 'socket', issues: [{ path: [], message: 'socket or tcp, not both' }] },
    { key: 'tcp', issues: [{ path: [], message: 'socket or tcp, not both' }] },
  ])
  close()
})

it('leaves a partial write accepted when the whole-object rule it would break is not triggered', async () => {
  const { db, close } = fresh()
  eitherOr()
  recordInstall(db, 'eitheror', 'enzyme')
  expect(await rejectedSettings(db, [dir], 'eitheror', { socket: '/tmp/s' })).toEqual([])
  close()
})

// A pre-0.8 plugin can emit an issue with no path at all. support/thrown.ts renders it as a
// whole-object refusal, so enablePlugin reports it — while this reader dropped it and PUT
// answered 200. One value, two duck-typed readers, opposite verdicts (re-review, minor 3).
function pathless(): void {
  mkdirSync(join(dir, 'pathless', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'pathless', 'spore.yaml'),
    'kind: enzyme\nname: pathless\nseptum: "^0.8"\n'
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
  const rejected = await rejectedSettings(db, [dir], 'pathless', { a: 1, b: 2 })
  const issues = [
    { message: 'the whole thing is wrong' },
    { path: 'notanarray', message: 'so is this' },
  ]
  expect(rejected).toEqual([{ key: 'a', issues }, { key: 'b', issues }])
  // The same two issues through the other reader, which has always treated them this way.
  expect(describeConfigError({ issues })).toBe('the whole thing is wrong; so is this')
  close()
})

// Duck-typed like handwritten(): a spore under /tmp cannot resolve the workspace's zod.
// `secrets` is a plain array literal, exactly what a plugin's own bundled septum would emit.
function vault(): void {
  mkdirSync(join(dir, 'vault', 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'vault', 'spore.yaml'),
    'kind: enzyme\nname: vault\nseptum: "^0.9"\n'
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
    'kind: enzyme\nname: twin\nseptum: "^0.9"\n'
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

it('writing the mask back to a secret leaves the stored credential intact', async () => {
  const { db, close } = fresh()
  vault()
  recordInstall(db, 'vault', 'enzyme')
  await writeDeclaredSetting(db, [dir], 'vault', 'token', 's3cr3t')
  await writeDeclaredSetting(db, [dir], 'vault', 'token', REDACTED)
  expect(readSettings(db, 'vault')).toEqual({ token: 's3cr3t' })
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
