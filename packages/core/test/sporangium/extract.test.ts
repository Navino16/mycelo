import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { MAX_UNPACKED_BYTES } from '../../src/sporangium/driver.js'
import { extractTarball } from '../../src/sporangium/extract.js'

async function tarOf(cwd: string, ...members: string[]): Promise<Uint8Array> {
  const out = join(mkdtempSync(join(tmpdir(), 'tar-')), 'a.tgz')
  expect(await Bun.spawn(['tar', '-czf', out, '-C', cwd, ...members]).exited).toBe(0)
  return new Uint8Array(await Bun.file(out).arrayBuffer())
}

describe('extractTarball', () => {
  test('unpacks a well-formed bundle', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'spore.yaml'), 'name: radarr\n')
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    await extractTarball(await tarOf(src, 'radarr'), dest)
    expect(readdirSync(join(dest, 'radarr'))).toEqual(['spore.yaml'])
  })

  test('rejects an archive tar refuses, rather than reporting success', async () => {
    // GNU tar refuses a `..` member with exit 2 and extracts partially before failing, so
    // the exit code is the only signal and the destination must be discardable (design §9.1).
    const src = mkdtempSync(join(tmpdir(), 'evil-'))
    mkdirSync(join(src, 'ok'))
    writeFileSync(join(src, 'ok', 'f.txt'), 'x')
    writeFileSync(join(src, 'escape.txt'), 'x')
    const out = join(mkdtempSync(join(tmpdir(), 'tar-')), 'evil.tgz')
    // -P is required: GNU tar sanitises `../` at creation, so an archive built without it
    // proves nothing about what an attacker would send.
    await Bun.spawn(['tar', '-czPf', out, '-C', src, 'ok', `../${basename(src)}/escape.txt`]).exited
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    const bytes = new Uint8Array(await Bun.file(out).arrayBuffer())
    expect(extractTarball(bytes, dest)).rejects.toThrow(/exit 2/)
  })

  test('writes nothing outside the destination it was given', async () => {
    // What makes the destination discardable (design §9.1): everything extraction writes,
    // the staged archive included, is inside it.
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'spore.yaml'), 'name: radarr\n')
    const parent = mkdtempSync(join(tmpdir(), 'parent-'))
    const dest = join(parent, 'dest')
    mkdirSync(dest)
    await extractTarball(await tarOf(src, 'radarr'), dest)
    expect(readdirSync(parent)).toEqual(['dest'])
  })

  test('names the missing binary when tar is absent', async () => {
    // design §9.1: tar is a runtime requirement of the host, and its absence must be legible.
    // A well-formed archive, or decompression refuses it before tar is ever spawned.
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'spore.yaml'), 'name: radarr\n')
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    expect(extractTarball(await tarOf(src, 'radarr'), dest, 'definitely-not-tar'))
      .rejects.toThrow(/definitely-not-tar/)
  })

  test('reports the exit code and stderr for gzip that is not a tarball at all', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    const gzipped = gzipSync(new TextEncoder().encode('not a tarball'))
    expect(extractTarball(new Uint8Array(gzipped), dest)).rejects.toThrow(/'tar' refused the archive/)
  })

  test('refuses bytes that are not gzip at all, naming decompression', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    expect(extractTarball(new TextEncoder().encode('not gzip'), dest)).rejects.toThrow(/cannot decompress/)
  })

  test('refuses a gzip bomb naming the cap, and writes no unpacked tree', async () => {
    // An uncurated sporangium's asset is attacker-influenced and lands beside the database:
    // 51 KB on the wire expanding to 50 MiB would otherwise be written in full.
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(MAX_UNPACKED_BYTES + 1024, 0)))
    expect(bomb.byteLength).toBeLessThan(1024 * 1024)
    expect(extractTarball(bomb, dest)).rejects.toThrow(new RegExp(String(MAX_UNPACKED_BYTES)))
    expect(readdirSync(dest)).toEqual([])
  })

  // The positive control for the cap: an archive under it still unpacks, so the refusal above
  // is the bound firing rather than decompression being broken outright.
  test('unpacks an archive whose expansion is under the cap', async () => {
    const src = mkdtempSync(join(tmpdir(), 'src-'))
    mkdirSync(join(src, 'radarr'))
    writeFileSync(join(src, 'radarr', 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 7))
    const dest = mkdtempSync(join(tmpdir(), 'dest-'))
    await extractTarball(await tarOf(src, 'radarr'), dest)
    expect(readdirSync(join(dest, 'radarr'))).toEqual(['big.bin'])
  })
})
