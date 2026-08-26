import { describe, expect, it } from 'bun:test'
import { SEPTUM_VERSION } from '../src/version.js'

describe('SEPTUM_VERSION', () => {
  it('equals the version in package.json, so the two cannot drift', async () => {
    const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as { version: string }
    expect(SEPTUM_VERSION).toBe(pkg.version)
  })

  it('is a parseable version, so Bun.semver can compare it against a range', () => {
    expect(Bun.semver.satisfies(SEPTUM_VERSION, `=${SEPTUM_VERSION}`)).toBe(true)
  })
})
