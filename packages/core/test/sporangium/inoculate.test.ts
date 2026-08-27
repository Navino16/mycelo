import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { Logger } from '@mycelo/septum'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { getInstall, recordInstall, setEnabled } from '../../src/config/store.js'
import { discover } from '../../src/germination/discover.js'
import type { Db } from '../../src/persistence/db.js'
import { pluginInstall } from '../../src/persistence/schema.js'
import type { SporangiumDriver } from '../../src/sporangium/driver.js'
import { parseTag } from '../../src/sporangium/github.js'
import { createStagingDir, inoculate, managedRoot, STAGING_DIR, sweepStaging, treeProblem } from '../../src/sporangium/inoculate.js'
import { addSource, deleteSource, installsFromSource, listSources, seedOfficialSource, updateSource } from '../../src/sporangium/sources.js'
import { freshDb } from '../support/db.js'
import { recordingLogger, silentLogger } from '../support/logger.js'

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

  test('refuses a symlink anywhere in the bundle, naming it', () => {
    // A bundle from an unreviewed sporangium is unpacked and read before it ever runs, so a
    // link out of the tree is read as this process's uid.
    const shallow = tree({ 'radarr/spore.yaml': MANIFEST })
    symlinkSync('/etc/hostname', join(shallow, 'radarr', 'index.js'))
    expect(treeProblem(shallow, 'radarr')).toContain('index.js')
    expect(treeProblem(shallow, 'radarr')).toContain('symlink')

    const deep = tree({ 'radarr/spore.yaml': MANIFEST, 'radarr/index.js': MODULE, 'radarr/translations/en.yaml': 'a: b' })
    symlinkSync('/etc/hostname', join(deep, 'radarr', 'translations', 'fr.yaml'))
    expect(treeProblem(deep, 'radarr')).toContain('translations/fr.yaml')

    // The manifest itself is the worst case: it is read, and the yaml parser quotes the
    // offending source line back into the refusal.
    const manifestLink = tree({ 'radarr/index.js': MODULE })
    symlinkSync('/etc/hostname', join(manifestLink, 'radarr', 'spore.yaml'))
    expect(treeProblem(manifestLink, 'radarr')).toContain('symlink')
  })

  test.skipIf(process.getuid?.() === 0)('never puts the staging path in a read failure', () => {
    // EACCES carries the absolute path; EISDIR does not. This string is returned to an API
    // client, and spec §10 forbids an absolute path there.
    const dir = tree({ 'radarr/spore.yaml': MANIFEST, 'radarr/index.js': MODULE })
    chmodSync(join(dir, 'radarr', 'spore.yaml'), 0o000)
    const problem = treeProblem(dir, 'radarr')
    expect(problem).toContain('permission denied')
    expect(problem).not.toContain(dir)
    expect(problem).not.toContain('/tmp')
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

function ctxOf(
  db: Db, driver: SporangiumDriver, root: string,
  sporesDirs: readonly string[] = [], logger: Logger = silentLogger(),
) {
  return { db, sporesDirs, managedRoot: root, logger, driverFor: () => driver }
}

function managedDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'managed-')), 'spores')
}

function officialId(db: Db): number {
  seedOfficialSource(db)
  return listSources(db).find((source) => source.official)!.id
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

  test('refuses a second install, naming the managed root and logging the path', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const { logger, lines } = recordingLogger()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })).ok).toBe(true)
    const second = await inoculate(ctxOf(db, stubDriver(tarball), root, [], logger), { sourceId: id, name: 'radarr' })
    expect(second.ok).toBe(false)
    expect(why(second)).toContain('the managed root')
    // The two halves of the split: no filesystem layout to the caller, the path to the log.
    expect(why(second)).not.toContain(root)
    expect(lines.join('\n')).toContain(join(root, 'radarr'))
  })

  test('refuses a name an operator-configured root already holds, distinguishing it from the managed root', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), MANIFEST)
    const { logger, lines } = recordingLogger()
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), managedDir(), [held], logger), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('a configured spores directory')
    expect(why(result)).not.toContain('the managed root')
    expect(why(result)).not.toContain(held)
    expect(lines.join('\n')).toContain(join(held, 'radarr'))
  })

  test('a configured root nested inside the managed root is still reported as configured', async () => {
    // The boundary between an exact parent test and a prefix test: a prefix would call this
    // the managed root, which is the one place the operator would not look.
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const nested = join(root, 'extra')
    mkdirSync(join(nested, 'radarr'), { recursive: true })
    writeFileSync(join(nested, 'radarr', 'spore.yaml'), MANIFEST)
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root, [nested]), { sourceId: id, name: 'radarr' })
    expect(why(result)).toContain('a configured spores directory')
    expect(why(result)).not.toContain('the managed root')
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

  test('a third-party install with a missing dependency carries both warnings', async () => {
    // The plural case on the output array: appending one warning must not drop the other,
    // and the trust warning is the one phase 8 exists to deliver.
    const { db } = freshDb()
    const third = addSource(db, { label: 'someone else', driver: 'github', location: 'https://github.com/x/y' })
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - rhiza: radarr',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir()), { sourceId: third.id, name: 'upcoming-movies' })
    expect(result.ok).toBe(true)
    const warnings = result.ok ? result.warnings : []
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('not code-reviewed')
    expect(warnings[1]).toContain("'radarr'")
  })

  test('a disabled install satisfies nothing, so the requirement is still warned about', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const held = mkdtempSync(join(tmpdir(), 'operator-'))
    mkdirSync(join(held, 'radarr'))
    writeFileSync(join(held, 'radarr', 'spore.yaml'), MANIFEST)
    recordInstall(db, 'radarr', 'rhiza', false)
    const manifest = [
      'name: upcoming-movies', 'kind: enzyme', 'septum: "^0.10"',
      'requires:', '  - rhiza: radarr',
      'commands:', '  - name: upcoming', '    description: command.upcoming.description', '    code: handleUpcoming',
    ].join('\n')
    const tarball = await bundleOf('upcoming-movies', { 'spore.yaml': manifest, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'upcoming-movies' })
    expect(result.ok && result.warnings.join(' ')).toContain("'radarr'")
    // The control: the same tree with the install enabled warns about nothing.
    setEnabled(db, 'radarr', true)
    const second = await inoculate(ctxOf(db, stubDriver(tarball, ['0.2.0']), managedDir(), [held]), { sourceId: id, name: 'upcoming-movies' })
    expect(second.ok && second.warnings).toEqual([])
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

  test('refuses a real tarball carrying a symlink, leaving nothing on disk', async () => {
    // tar stores a symlink as a symlink, so this is the shape an unreviewed sporangium would
    // actually ship: the link is read as this process's uid before the spore ever runs.
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const src = mkdtempSync(join(tmpdir(), 'bundle-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'spore.yaml'), MANIFEST)
    symlinkSync('/etc/hostname', join(src, 'radarr', 'index.js'))
    const out = join(mkdtempSync(join(tmpdir(), 'tgz-')), 'a.tgz')
    expect(await Bun.spawn(['tar', '-czf', out, '-C', src, 'radarr']).exited).toBe(0)
    const tarball = new Uint8Array(await Bun.file(out).arrayBuffer())
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('symlink')
    expect(existsSync(join(root, 'radarr'))).toBe(false)
    expect(getInstall(db, 'radarr')).toBeNull()
  })

  test('refuses an unreadable bundle without throwing, and still clears staging', async () => {
    // tar preserves modes, so a bundle can ship its own directory at mode 000: readdirSync
    // then fails inside validation and rmSync cannot remove what it cannot traverse.
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const src = mkdtempSync(join(tmpdir(), 'bundle-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'spore.yaml'), MANIFEST)
    writeFileSync(join(src, 'radarr', 'index.js'), MODULE)
    const out = join(mkdtempSync(join(tmpdir(), 'tgz-')), 'a.tgz')
    expect(await Bun.spawn(['tar', '-czf', out, '--mode=0000', '-C', src, 'radarr']).exited).toBe(0)
    const tarball = new Uint8Array(await Bun.file(out).arrayBuffer())
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('cannot be inspected')
    expect(why(result)).not.toContain(root)
    expect(readdirSync(join(root, STAGING_DIR))).toEqual([])
    expect(getInstall(db, 'radarr')).toBeNull()
  })

  test('sweepStaging removes a leftover it cannot traverse', () => {
    const root = managedDir()
    const leftover = join(root, STAGING_DIR, 'x-abc', 'radarr')
    mkdirSync(leftover, { recursive: true })
    writeFileSync(join(leftover, 'spore.yaml'), MANIFEST)
    chmodSync(leftover, 0o000)
    sweepStaging(root)
    expect(existsSync(join(root, STAGING_DIR))).toBe(false)
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

  test('stages two levels inside the managed root, and leaves nothing behind either way', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    const good = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(good), root), { sourceId: id, name: 'radarr' })).ok).toBe(true)
    // The parent survives and is empty: that is what says staging happened here, two levels
    // down, rather than in the OS temp directory.
    expect(existsSync(join(root, STAGING_DIR))).toBe(true)
    expect(readdirSync(join(root, STAGING_DIR))).toEqual([])
    const bad = await bundleOf('other', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    expect((await inoculate(ctxOf(db, stubDriver(bad), root), { sourceId: id, name: 'other' })).ok).toBe(false)
    expect(readdirSync(join(root, STAGING_DIR))).toEqual([])
    expect(discover([root]).map((l) => l.directory)).toEqual(['radarr'])
  })

  test('createStagingDir sits exactly two levels below the managed root, and is unique', () => {
    const root = managedDir()
    const first = createStagingDir(root)
    const second = createStagingDir(root)
    expect(first).not.toBe(second)
    for (const staging of [first, second]) {
      expect(basename(dirname(staging))).toBe(STAGING_DIR)
      expect(dirname(dirname(staging))).toBe(root)
    }
  })

  test('a crashed install is invisible to discover at two levels, and visible at one', () => {
    // discover skips no dot-directory — it requires only a spore.yaml — so the depth is the
    // whole guard: at one level the staging directory is itself discovered as a spore.
    const root = managedDir()
    mkdirSync(join(root, STAGING_DIR, 'x-abc'), { recursive: true })
    writeFileSync(join(root, STAGING_DIR, 'x-abc', 'spore.yaml'), MANIFEST)
    expect(discover([root])).toEqual([])
    mkdirSync(join(root, `${STAGING_DIR}-abc`), { recursive: true })
    writeFileSync(join(root, `${STAGING_DIR}-abc`, 'spore.yaml'), MANIFEST)
    expect(discover([root]).map((l) => l.directory)).toEqual([`${STAGING_DIR}-abc`])
  })

  test('sweepStaging removes what a crashed install left, and tolerates a root with none', () => {
    const root = managedDir()
    mkdirSync(join(root, STAGING_DIR, 'x-abc'), { recursive: true })
    writeFileSync(join(root, STAGING_DIR, 'x-abc', 'spore.yaml'), MANIFEST)
    sweepStaging(root)
    expect(existsSync(join(root, STAGING_DIR))).toBe(false)
    expect(() => { sweepStaging(root) }).not.toThrow()
    expect(() => { sweepStaging(join(root, 'never-created')) }).not.toThrow()
  })

  test('refuses when a stray directory already occupies the name, naming neither path', async () => {
    // The collision check uses discover(), which needs a spore.yaml, so a directory without
    // one is invisible to it and only surfaces at the rename.
    const { db } = freshDb()
    const id = officialId(db)
    const root = managedDir()
    mkdirSync(join(root, 'radarr'), { recursive: true })
    writeFileSync(join(root, 'radarr', 'leftover.txt'), 'x')
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('managed root')
    expect(why(result)).not.toContain(root)
    expect(getInstall(db, 'radarr')).toBeNull()
    expect(readdirSync(join(root, 'radarr'))).toEqual(['leftover.txt'])
  })

  test('refuses when the managed root cannot be created', async () => {
    const { db } = freshDb()
    const id = officialId(db)
    const file = join(mkdtempSync(join(tmpdir(), 'blocked-')), 'a-file')
    writeFileSync(file, 'x')
    const tarball = await bundleOf('radarr', { 'spore.yaml': MANIFEST, 'index.js': MODULE })
    const result = await inoculate(ctxOf(db, stubDriver(tarball), join(file, 'spores')), { sourceId: id, name: 'radarr' })
    expect(result.ok).toBe(false)
    expect(why(result)).toContain('managed root cannot be written')
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
    // Stated on its own rather than left to `join(root, '') === root`: the guard runs before
    // anything creates the managed root, and the staging directory lives inside it.
    expect(existsSync(root)).toBe(false)
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
    // The boolean cannot say why; this is what lets a caller name the blockers.
    expect(installsFromSource(db, third.id)).toEqual(['radarr'])
    expect(installsFromSource(db, officialId(db))).toEqual([])
  })

  test('installsFromSource names every blocker, sorted, not just the first', async () => {
    const { db } = freshDb()
    const third = addSource(db, { label: 'someone else', driver: 'github', location: 'https://github.com/x/y' })
    const root = managedDir()
    for (const name of ['sonarr', 'radarr']) {
      const manifest = MANIFEST.replace('name: radarr', `name: ${name}`)
      const tarball = await bundleOf(name, { 'spore.yaml': manifest, 'index.js': MODULE })
      expect((await inoculate(ctxOf(db, stubDriver(tarball), root), { sourceId: third.id, name })).ok).toBe(true)
    }
    expect(installsFromSource(db, third.id)).toEqual(['radarr', 'sonarr'])
    expect(deleteSource(db, third.id)).toBe(false)
  })
})
