import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** A released spore's shape: one top-level directory, gzipped, as `release.yml` attaches it. */
export async function bundleOf(name: string, files: Record<string, string>): Promise<Uint8Array> {
  const src = mkdtempSync(join(tmpdir(), 'bundle-'))
  for (const [path, body] of Object.entries(files)) {
    const full = join(src, name, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  const out = join(mkdtempSync(join(tmpdir(), 'tgz-')), 'a.tgz')
  const code = await Bun.spawn(['tar', '-czf', out, '-C', src, name]).exited
  if (code !== 0) throw new Error(`tar exited ${String(code)}`)
  return new Uint8Array(await Bun.file(out).arrayBuffer())
}
