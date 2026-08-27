/**
 * Reads a stream into memory, cancelling past `cap` — so an over-size source is refused after
 * `cap` bytes rather than after all of them. Buffering the whole body first and measuring it
 * afterwards is not a bound: the allocation has already happened.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array>, cap: number, overflow: () => Error,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel()
      throw overflow()
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
