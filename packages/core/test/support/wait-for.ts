/** Polls until `assertion` stops throwing. Replaces vi.waitFor, absent from bun:test. */
export async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  for (;;) {
    try {
      assertion()
      return
    } catch (e) {
      last = e
      if (Date.now() >= deadline) throw last
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}
