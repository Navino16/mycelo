import { expect } from 'bun:test'

/**
 * bun:test types `expect(p).rejects.toThrow()` as void, so awaiting it trips
 * await-thenable — and *not* awaiting it makes the assertion never run at all.
 */
export async function rejectsWith(promise: Promise<unknown>, match: RegExp): Promise<void> {
  try {
    await promise
  } catch (e) {
    expect((e as Error).message).toMatch(match)
    return
  }
  throw new Error(`expected a rejection matching ${match.source}, but it resolved`)
}
