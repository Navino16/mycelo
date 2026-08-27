import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

function spawnTar(bin: string, archive: string, dest: string): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  return Bun.spawn([bin, '-xzf', archive, '-C', dest], { stdout: 'pipe', stderr: 'pipe' })
}

/**
 * Bun cannot read a tar archive — there is no tar function of any kind — so one is spawned
 * (design §9.1). A partial extraction is possible before a non-zero exit, which is why
 * `dest` is always a directory the caller can discard.
 */
export async function extractTarball(tarball: Uint8Array, dest: string, bin = 'tar'): Promise<void> {
  const archive = join(dest, '.bundle.tgz')
  writeFileSync(archive, tarball)
  let proc: ReturnType<typeof spawnTar>
  try {
    proc = spawnTar(bin, archive, dest)
  } catch {
    // Bun.spawn throws synchronously on a missing binary, before `exited` is ever awaited.
    throw new Error(`cannot run '${bin}': installing a spore requires it on the host`)
  }
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`'${bin}' refused the archive (exit ${String(code)}): ${stderr.trim()}`)
  }
}
