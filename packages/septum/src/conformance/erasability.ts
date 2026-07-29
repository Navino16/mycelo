import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
 * This does not guess what Node accepts, it asks Node. If a future Node widens what
 * it can strip, this follows with no rule to update.
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
  const dir = mkdtempSync(join(tmpdir(), 'mycelo-erase-'))
  const file = join(dir, 'candidate.mjs')
  try {
    writeFileSync(file, js, 'utf8')
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    return null
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? (e as Error).message)
    const line = stderr.split('\n').find((l) => l.includes('Error:'))?.trim()
    return `after stripping: ${line ?? 'parse failed'}`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Same check, as an assertion. Use in a plugin's own test suite. */
export function assertErasable(source: string): void {
  const reason = erasabilityError(source)
  if (reason !== null) {
    throw new Error(`source is not erasable: ${reason}`)
  }
}
