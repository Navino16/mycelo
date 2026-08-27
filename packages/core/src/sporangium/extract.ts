import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_UNPACKED_BYTES } from './driver.js'

/** Decompressed before tar sees it, so this is a plain tar. treeProblem filters it by name. */
export const BUNDLE_ARCHIVE = '.bundle.tar'

function spawnTar(bin: string, archive: string, dest: string): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  return Bun.spawn([bin, '-xf', archive, '-C', dest], { stdout: 'pipe', stderr: 'pipe' })
}

/**
 * Decompressed here rather than by `tar -xzf` so the expansion is counted and stopped: a gzip
 * bomb is small on the wire and unbounded on disk, and tar has no size option. Streaming, so a
 * bomb is refused after reading the cap rather than after expanding the whole archive.
 */
async function gunzipBounded(tarball: Uint8Array, cap: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(tarball)
      controller.close()
    },
  })
  // DecompressionStream's readable is typed `any` under these libs, so the chunk type is
  // restated here rather than propagated as `any` into the length arithmetic below.
  const decompressed = source.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>
  const reader = decompressed.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel()
      throw new Error(`the archive unpacks to more than ${String(cap)} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * Bun cannot read a tar archive — there is no tar function of any kind — so one is spawned
 * (design §9.1). A partial extraction is possible before a non-zero exit, which is why
 * `dest` is always a directory the caller can discard.
 */
export async function extractTarball(tarball: Uint8Array, dest: string, bin = 'tar'): Promise<void> {
  const archive = join(dest, BUNDLE_ARCHIVE)
  let unpacked: Uint8Array
  try {
    unpacked = await gunzipBounded(tarball, MAX_UNPACKED_BYTES)
  } catch (e) {
    throw new Error(`cannot decompress the archive: ${(e as Error).message}`)
  }
  writeFileSync(archive, unpacked)
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
