import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether Node's type-stripping loader can load this source.
 *
 * Two stages, because no single one covers everything. Stripping rejects the four
 * TypeScript-only constructs (enum, const enum, namespace, parameter property).
 * Decorators survive stripping — TypeScript treats them as future JavaScript — and
 * are only caught when the resulting module is parsed.
 *
 * @returns null when loadable, otherwise a one-line reason.
 */
export function erasabilityError(source: string): string | null {
  let js: string
  try {
    js = stripTypeScriptTypes(source, { mode: 'strip' })
  } catch (e) {
    return (e as Error).message.split('\n')[0] ?? 'strip failed'
  }

  // The stripped output is an ES module, so it cannot be compiled as a script.
  // Writing it as .mjs and running `node --check` parses it exactly as the loader
  // would, and needs no experimental flag.
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'mycelo-erase-'))
  } catch (e) {
    return environmentError(e)
  }
  const file = join(dir, 'candidate.mjs')
  try {
    writeFileSync(file, js, 'utf8')
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    return null
  } catch (e) {
    // `node --check` reports a parse error by exiting non-zero, which sets `status`.
    // Anything else — a read-only tmpdir, a sandbox that blocks spawning — never
    // reached the parser and says nothing about the source under test.
    if (typeof (e as { status?: unknown }).status !== 'number') return environmentError(e)
    const stderrValue = (e as { stderr?: unknown }).stderr
    const stderr = Buffer.isBuffer(stderrValue)
      ? stderrValue.toString('utf8')
      : typeof stderrValue === 'string'
        ? stderrValue
        : (e as Error).message
    const line = stderr.split('\n').find((l) => l.includes('Error:'))?.trim()
    return `after stripping: ${line ?? 'parse failed'}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The environment failed, not the source. */
function environmentError(e: unknown): string {
  return `erasability check could not run: ${(e as Error).message}`
}

/** Same check, as an assertion. Use in a plugin's own test suite. */
export function assertErasable(source: string): void {
  const reason = erasabilityError(source)
  if (reason !== null) {
    throw new Error(`source is not erasable: ${reason}`)
  }
}

/**
 * Runs the erasability check over a plugin's own source files.
 *
 * Catches source that works bundled by esbuild and breaks when the `local` driver
 * loads it unbundled — a failure that only appears in development.
 *
 * Omitting the paths skips the check, which is correct for a harness testing an
 * in-memory module with no file on disk.
 */
export async function sourceErasabilityFailures(
  paths: readonly string[] | undefined,
): Promise<string[]> {
  if (paths === undefined || paths.length === 0) return []
  const failures: string[] = []
  for (const path of paths) {
    let source: string
    try {
      source = await readFile(path, 'utf8')
    } catch (e) {
      failures.push(`cannot read source ${path}: ${(e as Error).message}`)
      continue
    }
    const reason = erasabilityError(source)
    if (reason !== null) {
      failures.push(`${path} is not erasable: ${reason}`)
    }
  }
  return failures
}
