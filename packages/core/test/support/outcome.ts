import type { Outcome, OutcomeOf, TranslatableRef } from '@mycelo/septum'

/**
 * The ref a mycelium method refused with. Throws on success rather than returning undefined, so a
 * test that stopped refusing fails here instead of comparing two absent values.
 */
export async function refusalOf(promise: Promise<Outcome | OutcomeOf<unknown>>): Promise<TranslatableRef> {
  const result = await promise
  if (result.ok) throw new Error('expected a refusal, but the call answered ok')
  return result.refusal
}

/** The value of a method that answers one, failing loudly on a refusal instead of reading undefined. */
export async function valueOf<T>(promise: Promise<OutcomeOf<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(`expected a value, but the call refused with '${result.refusal.key}'`)
  return result.value
}

/** Asserts a method did its work: a silent `{ ok: false }` used to be a rejection a test could see. */
export async function succeeds(promise: Promise<Outcome>): Promise<void> {
  const result = await promise
  if (!result.ok) throw new Error(`expected success, but the call refused with '${result.refusal.key}'`)
}
