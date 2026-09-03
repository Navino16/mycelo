import { describe, expect, it } from 'bun:test'
import { isNewerStrain } from '../src/strains.ts'

describe('comparing two strains', () => {
  it('sees a newer offer', () => {
    expect(isNewerStrain('2.1.0', '1.8.4')).toBe(true)
    expect(isNewerStrain('1.2.4', '1.2.3')).toBe(true)
    expect(isNewerStrain('1.3.0', '1.2.9')).toBe(true)
  })

  it('sees an equal or older offer as no update', () => {
    expect(isNewerStrain('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerStrain('1.8.4', '2.1.0')).toBe(false)
    expect(isNewerStrain('1.2.3', '1.2.4')).toBe(false)
  })

  // The case a string compare gets wrong: '1.10.0' < '1.9.0' lexicographically.
  it('compares each part as a number, so 1.10.0 is newer than 1.9.0', () => {
    expect(isNewerStrain('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerStrain('1.9.0', '1.10.0')).toBe(false)
    expect(isNewerStrain('10.0.0', '9.9.9')).toBe(true)
    expect(isNewerStrain('1.0.10', '1.0.9')).toBe(true)
  })

  // Both sides cross the API boundary as strings, and claiming an update that does not exist
  // is worse than showing none.
  it('claims no update when either side is not a semver triple', () => {
    expect(isNewerStrain('latest', '1.0.0')).toBe(false)
    expect(isNewerStrain('2.0.0', 'unknown')).toBe(false)
    expect(isNewerStrain('', '')).toBe(false)
    expect(isNewerStrain('2.0', '1.0.0')).toBe(false)
  })

  it('ignores a prerelease or build suffix rather than refusing the comparison', () => {
    expect(isNewerStrain('1.3.0-rc.1', '1.2.0')).toBe(true)
    expect(isNewerStrain('1.2.0', '1.3.0-rc.1')).toBe(false)
  })
})
