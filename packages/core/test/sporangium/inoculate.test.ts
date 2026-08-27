import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getInstall } from '../../src/config/store.js'
import type { Db } from '../../src/persistence/db.js'
import { pluginInstall } from '../../src/persistence/schema.js'
import type { SporangiumDriver } from '../../src/sporangium/driver.js'
import { parseTag } from '../../src/sporangium/github.js'
import { inoculate, managedRoot, treeProblem } from '../../src/sporangium/inoculate.js'
import { addSource, deleteSource, listSources, seedOfficialSource, updateSource } from '../../src/sporangium/sources.js'
import { freshDb } from '../support/db.js'
import { silentLogger } from '../support/logger.js'

function tree(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'))
  for (const [path, body] of Object.entries(entries)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

const MANIFEST = ['name: radarr', 'kind: rhiza', 'septum: "^0.10"'].join('\n')
const MODULE = 'export default { create: () => ({}) }'

describe('treeProblem', () => {
  test('accepts a well-formed bundle', () => {
    expect(treeProblem(tree({ 'radarr/spore.yaml': MANIFEST, 'radarr/index.js': MODULE }), 'radarr')).toBeNull()
  })

  test('refuses a second top-level directory, naming it', () => {
    // Measured (design §9.1): an archive carrying radarr/ and evil/ extracts both, and the
    // second would be found by the next discover() with no install row.
    const problem = treeProblem(tree({
      'radarr/spore.yaml': MANIFEST,
      'radarr/index.js': MODULE,
      'evil/spore.yaml': MANIFEST,
    }), 'radarr')
    expect(problem).toContain('evil')
  })

  test('names every extra top-level entry, not just the first', () => {
    const problem = treeProblem(tree({
      'radarr/spore.yaml': MANIFEST,
      'radarr/index.js': MODULE,
      'evil/spore.yaml': MANIFEST,
      'worse/spore.yaml': MANIFEST,
      'README.md': 'x',
    }), 'radarr')
    expect(problem).toContain('evil')
    expect(problem).toContain('worse')
    expect(problem).toContain('README.md')
  })

  test('refuses a top-level file beside the directory', () => {
    expect(treeProblem(tree({
      'radarr/spore.yaml': MANIFEST,
      'radarr/index.js': MODULE,
      'README.md': 'x',
    }), 'radarr')).toContain('README.md')
  })

  test('refuses a directory not named for the requested spore', () => {
    expect(treeProblem(tree({ 'other/spore.yaml': MANIFEST }), 'radarr')).toContain('radarr')
  })

  test('refuses an empty archive', () => {
    expect(treeProblem(mkdtempSync(join(tmpdir(), 'tree-')), 'radarr')).toContain('empty')
  })

  test('refuses a missing spore.yaml by name, without leaking the staging path', () => {
    // readManifest would also refuse, with an ENOENT carrying the absolute staging path —
    // and this string is returned to an API client.
    const problem = treeProblem(tree({ 'radarr/index.js': MODULE }), 'radarr')
    expect(problem).toBe('the archive holds no spore.yaml')
  })

  test('refuses a manifest that does not parse', () => {
    expect(treeProblem(tree({
      'radarr/spore.yaml': 'name: radarr\nkind: not-a-kind\n',
      'radarr/index.js': MODULE,
    }), 'radarr')).toContain('does not parse')
  })

  test('refuses a manifest whose name is not the requested one', () => {
    expect(treeProblem(tree({
      'radarr/spore.yaml': 'name: sonarr\nkind: rhiza\nseptum: "^0.10"\n',
      'radarr/index.js': MODULE,
    }), 'radarr')).toContain('sonarr')
  })

  test('refuses a bundle carrying src/, per design §4.1', () => {
    // Sources would be loaded in preference to index.js and fail to resolve zod, so the
    // spore would be dormant rather than refused.
    expect(treeProblem(tree({
      'radarr/spore.yaml': MANIFEST,
      'radarr/index.js': MODULE,
      'radarr/src/index.ts': 'x',
    }), 'radarr')).toContain('src')
  })

  test('refuses a spore whose septum range excludes the running core', () => {
    expect(treeProblem(tree({
      'radarr/spore.yaml': 'name: radarr\nkind: rhiza\nseptum: "^0.9"\n',
      'radarr/index.js': MODULE,
    }), 'radarr')).toContain('^0.9')
  })

  test('refuses a code spore with no entry point', () => {
    expect(treeProblem(tree({ 'radarr/spore.yaml': MANIFEST }), 'radarr')).toContain('entry point')
  })

  test('accepts every entry point a bundle may ship, and never names src/index.ts', () => {
    for (const entry of ['index.ts', 'dist/index.js', 'index.js']) {
      expect(treeProblem(tree({ 'radarr/spore.yaml': MANIFEST, [`radarr/${entry}`]: MODULE }), 'radarr')).toBeNull()
    }
    expect(treeProblem(tree({ 'radarr/spore.yaml': MANIFEST }), 'radarr')).not.toContain('src/index.ts')
  })

  test('accepts a respond-only enzyme with no module at all', () => {
    expect(treeProblem(tree({
      'hello/spore.yaml': [
        'name: hello', 'kind: enzyme', 'septum: "^0.10"',
        'commands:', '  - name: hi', '    description: command.hi.description', '    respond: reply.hi',
      ].join('\n'),
    }), 'hello')).toBeNull()
  })

  test('refuses an enzyme mixing respond: and code: with no module', () => {
    // The negative control for the respond-only acceptance above: one code command is
    // enough to need an entry point.
    expect(treeProblem(tree({
      'hello/spore.yaml': [
        'name: hello', 'kind: enzyme', 'septum: "^0.10"',
        'commands:',
        '  - name: hi', '    description: command.hi.description', '    respond: reply.hi',
        '  - name: ho', '    description: command.ho.description', '    code: handleHo',
      ].join('\n'),
    }), 'hello')).toContain('entry point')
  })
})

async function bundleOf(name: string, files: Record<string, string>): Promise<Uint8Array> {
  const src = mkdtempSync(join(tmpdir(), 'bundle-'))
  for (const [path, body] of Object.entries(files)) {
    const full = join(src, name, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  const out = join(mkdtempSync(join(tmpdir(), 'tgz-')), 'a.tgz')
  expect(await Bun.spawn(['tar', '-czf', out, '-C', src, name]).exited).toBe(0)
  return new Uint8Array(await Bun.file(out).arrayBuffer())
}

function stubDriver(tarball: Uint8Array, strains: readonly string[] = ['0.2.0', '0.1.0']): SporangiumDriver {
  return {
    list: () => Promise.resolve([{ name: 'radarr', strain: strains[0]! }]),
    strains: () => Promise.resolve(strains),
    detail: () => Promise.resolve({ name: 'radarr', kind: 'rhiza' as const, description: '', septum: '^0.10' }),
    fetch: (_name, strain) => Promise.resolve({ tarball, strain }),
  }
}

function ctxOf(db: Db, driver: SporangiumDriver, root: string, sporesDirs: readonly string[] = []) {
  return { db, sporesDirs, managedRoot: root, logger: silentLogger(), driverFor: () => driver }
}

function managedDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'managed-')), 'spores')
}

function officialId(db: Db): number {
  seedOfficialSource(db)
  return listSources(db)[0]!.id
}

function why(result: { ok: boolean, reason?: string }): string {
  return result.ok ? '' : result.reason ?? ''
}

describe('managedRoot', () => {
  test('sits beside the database, so data and spores move together', () => {
    expect(managedRoot('/var/lib/mycelo/mycelo.db')).toBe(join('/var/lib/mycelo', 'spores'))
  })
})

describe('inoculate', () => {
  test('installs the newest strain when none is asked for, and records it disabled', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(why(result)).toBe('')
    expect(result.ok).toBe(true)
    expect(result.ok && result.strain).toBe('0.2.0')
    expect(result.ok && result.restartRequired).toBe(true)
    // The official source carries no warning; the third-party test below is its control.
    expect(result.ok && result.warnings).toEqual([])
    expect(readdirSync(join(root, 'radarr')).sort()).toEqual(['index.js', 'spore.yaml'])
    expect(getInstall(db, 'radarr')?.enabled).toBe(false)
  })

  test('records the source and strain it installed from', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    await inoculate(ctxOf(db, stubDriver(tarball), managedDir()), { sourceId: id, name: 'radarr', strain: '0.1.0' })
    const row = db.select().from(pluginInstall).where(eq(pluginInstall.name, 'radarr')).get()
    expect(row?.sourceId).toBe(id)
    expect(row?.strain).toBe('0.1.0')
    expect(row?.kind).toBe('rhiza')
  })

  test('refuses a second install, naming the directory that holds it', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })).ok).toBe(true)
    const second = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(second.ok).toBe(false)
    expect(why(second)).toContain(join(root, 'radarr'))
  })

  test('refuses a name an operator-configured root already holds, naming that root', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), MANIFEST)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), managedDir(), [held]), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain(join(held, 'radarr'))
  })

  test('refuses a strain the source does not offer, naming the ones it does', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), managedDir()), { sourceId: id, name: 'radarr', strain: '99.0.0' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('0.2.0')
    expect(why(result)).toContain('0.1.0')
  })

  test('installs a strain the source does offer, and not the newest one', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), managedDir()), { sourceId: id, name: 'radarr', strain: '0.1.0' })
    expect(result.ok && result.strain).toBe('0.1.0')
  })

  test('refuses a source that offers no spore by that name', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, []), managedDir()), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('offers no spore')
  })

  test('a third-party source carries the core-owned warning', async () => {
    const { db } = freshDb()
    const third = addSource(db, { label: 'someone else', driver: 'github', location: 'https://github.com/x/y' })
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), managedDir()), { sourceId: third.id, name: 'radarr' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.warnings.join(' ')).toContain('not code-reviewed')
  })

  test('warns by name about a requirement nothing installed provides', async () => {
    // Deleting a requires: block left 146 tests green in both repositories, so the warning
    // is pinned by name (design §9.2).
    const { db } = freshDb()
    const id = officialId(db)
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - rhiza: radarr',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir()), { sourceId: id, name: 'upcoming-movies' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.warnings.join(' ')).toContain('radarr')
  })

  test('names every unsatisfied requirement, including every alternative of an any_of', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const manifest = [
      'name: now-watching', 'kind: enzyme', 'septum: "^0.10"',
      'requires:',
      '  - rhiza: radarr',
      '  - rhiza: sonarr',
      '  - any_of:', '      - rhiza: plex@^1', '      - rhiza: jellyfin@^10',
      'commands:', '  - name: watching', '    description: command.watching.description', '    code: handleWatching',
    ].join('\n')
    const tarball = await bundleOf('now-watching', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir()), { sourceId: id, name: 'now-watching' })
    const warning = result.ok ? result.warnings.join(' ') : ''
    for (const named of ["'radarr'", "'sonarr'", "'plex'", "'jellyfin'"]) expect(warning).toContain(named)
    expect(warning).not.toContain('@^')
  })

  test('does not warn about a requirement an installed rhiza satisfies, nor about an optional one', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), MANIFEST)
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:',
      '  - rhiza: radarr',
      '  - rhiza: sonarr', '    optional: true',
      '  - rhiza: mycelium', '    scopes: [plugins.read]',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'upcoming-movies' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.warnings).toEqual([])
  })

  test('a requirement carrying a semver range matches on the name alone', async () => {
    // septum's targetSchema allows 'radarr@^2'; phase 3 matches on the name and so must
    // this warning, in both directions — satisfied by name, and reported by name.
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), MANIFEST)
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - rhiza: radarr@^2', '  - rhiza: sonarr@^2',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'upcoming-movies' })
    const warning = result.ok ? result.warnings.join(' ') : ''
    expect(warning).toContain("'sonarr'")
    expect(warning).not.toContain('radarr')
    expect(warning).not.toContain('@^2')
  })

  test('an any_of is satisfied by any alternative, not only the first', async () => {
    // The plural case: with jellyfin installed and plex absent, collapsing the any_of to
    // its first alternative would warn about a requirement that is satisfied. The range on
    // the second alternative also pins that matching strips it.
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'jellyfin'))
    writeFileSync(join(held, 'jellyfin', 'spore.yaml'), 'name: jellyfin\nkind: rhiza\nseptum: "^0.10"\n')
    const manifest = [
      'name: now-watching', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - any_of:', '      - rhiza: plex', '      - rhiza: jellyfin@^10',
      'commands:', '  - name: watching', '    description: command.watching.description', '    code: handleWatching',
    ].join('\n')
    const tarball = await bundleOf('now-watching', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'now-watching' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.warnings).toEqual([])
  })

  test('warns about a requirement satisfied only by a spore of the wrong kind', async () => {
    // Phase 3 satisfies `rhiza:` with a rhiza and nothing else, so a name match alone
    // would promise a dependency the next boot goes dormant for.
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), [
      'name: radarr', 'kind: enzyme', 'septum: "^0.10"',
      'commands:', '  - name: r', '    description: command.r.description', '    respond: reply.r',
    ].join('\n'))
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - rhiza: radarr',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'upcoming-movies' })
    expect(result.ok && result.warnings.join(' ')).toContain('radarr')
  })

  test('a rejected bundle leaves nothing on disk and no install row', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE, 'src/index.ts': 'x' })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(existsSync(join(root, 'radarr'))).toBe(false)
    expect(getInstall(db, 'radarr')).toBeNull()
  })

  test('a tarball tar refuses leaves nothing on disk and no install row', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const notATarball = new TextEncoder().encode('not a tarball')
    const result = await inoculate(ctxOf(db, stubDriver(notATarball), root), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('cannot unpack')
    expect(existsSync(join(root, 'radarr'))).toBe(false)
    expect(getInstall(db, 'radarr')).toBeNull()
  })

  test('leaves no staging directory behind, on the happy path and on a refusal', async () => {
    const staging = (): number => readdirSync(tmpdir()).filter((e) => e.startsWith('inoculate-')).length
    const { db } = freshDb()
    const id = officialId(db)
    const before = staging()
    const good = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(good), managedDir()), { sourceId: id, name: 'radarr' })).ok).toBe(true)
    const bad = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE, 'src/index.ts': 'x' })
    expect((await inoculate(ctxOf(db, stubDriver(bad), managedDir()), { sourceId: id, name: 'radarr' })).ok).toBe(false)
    expect(staging()).toBe(before)
  })

  test('refuses a local source rather than failing later', async () => {
    // The row is written directly: design §7 gives a local source no driver, and the
    // refusal has to be reachable anyway.
    const { db } = freshDb()
    const local = addSource(db, { label: '/srv/spores', driver: 'local', location: '/srv/spores' })
    const result = await inoculate(ctxOf(db, stubDriver(new Uint8Array()), managedDir()), { sourceId: local.id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('local')
  })

  test('refuses a disabled source, and an id that does not exist', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    updateSource(db, id, { enabled: false })
    const disabled = await inoculate(ctxOf(db, stubDriver(new Uint8Array()), managedDir()), { sourceId: id, name: 'radarr' })
    expect(why(disabled)).toContain('disabled')
    const absent = await inoculate(ctxOf(db, stubDriver(new Uint8Array()), managedDir()), { sourceId: 999, name: 'radarr' })
    expect(why(absent)).toContain('999')
  })

  test('refuses a name that is not a spore name, before it can become a directory', async () => {
    // Defence in depth: parseTag already refuses this shape, and the guard below is the
    // second half of the pair. A traversal name must never reach the managed root.
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    for (const name of ['../../etc', 'a/b', '.', 'Radarr', '']) {
      const result = await inoculate(ctxOf(db, stubDriver(new Uint8Array()), root), { sourceId: id, name })
      expect(why(result)).toContain('not a spore name')
      expect(existsSync(join(root, name))).toBe(false)
    }
  })

  test('parseTag refuses a traversal name, so such an offer never reaches inoculate', () => {
    // The first guard of the pair above: the tag list is where a hostile name would enter.
    expect(parseTag('../../etc@0.1.0')).toBeNull()
    expect(parseTag('a/b@0.1.0')).toBeNull()
    expect(parseTag('radarr@0.1.0')).toEqual({ name: 'radarr', strain: '0.1.0' })
  })

  test('refuses a strain that is not a semver, before it is written to the install row', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    for (const strain of ['../../etc', '0.1', 'latest', '']) {
      const result = await inoculate(ctxOf(db, stubDriver(new Uint8Array()), managedDir()), { sourceId: id, name: 'radarr', strain })
      expect(why(result)).toContain('not a strain')
    }
  })

  test('refuses rather than throwing when the source location is junk', async () => {
    // No driverFor: the real githubDriver is built, and its methods reject on a bad
    // location. The HTTP route must get a refusal, never an unclassified 500.
    const { db } = freshDb()
    const junk = addSource(db, { label: 'junk', driver: 'github', location: 'not-a-url' })
    const result = await inoculate({
      db, sporesDirs: [], managedRoot: managedDir(), logger: silentLogger(),
    }, { sourceId: junk.id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('cannot read source')
  })

  test('refuses rather than throwing when the driver rejects the download', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const driver: SporangiumDriver = {
      ...stubDriver(new Uint8Array()),
      fetch: () => Promise.reject(new Error('release carries no asset')),
    }
    const result = await inoculate(ctxOf(db, driver, managedDir()), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('release carries no asset')
  })

  test('a source a spore is still installed from cannot be deleted', async () => {
    // Deleting the row would erase the provenance of spores still on disk; foreign keys
    // are ON, so an unguarded delete would throw instead of answering.
    const { db } = freshDb()
    const third = addSource(db, { label: 'someone else', driver: 'github', location: 'https://github.com/x/y' })
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(tarball), managedDir()), { sourceId: third.id, name: 'radarr' })).ok).toBe(true)
    expect(deleteSource(db, third.id)).toBe(false)
    expect(listSources(db).some((s) => s.id === third.id)).toBe(true)
  })
})
