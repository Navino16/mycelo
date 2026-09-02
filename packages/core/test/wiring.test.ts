import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const ROOT = join(import.meta.dir, '..', '..', '..')

function rootPackageJson(): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
}

describe('the ui package is wired into the gate', () => {
  // tsconfig.spec.json excludes packages/ui, so without this call nothing typechecks the SPA
  // and `bun run typecheck` passes by not looking (spec §2, point 1).
  it('the root typecheck script runs the ui package own typecheck', () => {
    expect(rootPackageJson().scripts['typecheck']).toContain('bun run --cwd packages/ui typecheck')
  })

  it('tsconfig.spec.json excludes the ui package, which its include would otherwise swallow', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'tsconfig.spec.json'), 'utf8')) as {
      exclude?: string[]
    }
    expect(spec.exclude ?? []).toContain('packages/ui/**')
  })

  // The root solution must not reference packages/ui: `prelint: tsc -b` runs it before every
  // lint, so a broken UI reference would break the lint of everything (spec §2, point 3).
  it('the root solution does not reference the ui package', () => {
    const root = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
    expect(root).not.toContain('packages/ui')
  })

  it('eslint has a block matching tsx, so the first component does not abort the lint', () => {
    expect(readFileSync(join(ROOT, 'eslint.config.js'), 'utf8')).toContain('packages/ui/**/*.{ts,tsx}')
  })

  // Deleting the build step leaves the suite green (whole-branch fix brief, item 4).
  it('the root ci script builds the ui package', () => {
    expect(rootPackageJson().scripts['ci']).toContain('bun run --cwd packages/ui build')
  })

  it('the vendored rjsf-shadcn CSS has no self-referential custom properties', () => {
    const css = readFileSync(join(ROOT, 'packages/ui/src/rjsf-shadcn.css'), 'utf8')
    expect(css).not.toMatch(/--font-(sans|serif|mono):var\(--font-\1\)/)
  })
})
