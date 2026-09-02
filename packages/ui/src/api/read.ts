/** Guards a value that should be an array but crossed the API boundary unchecked. */
export function readArray<T>(value: unknown): readonly T[] | undefined {
  return Array.isArray(value) ? value as readonly T[] : undefined
}
