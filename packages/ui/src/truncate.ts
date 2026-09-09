/** Keeps the tail: two sibling paths differ at their end, and CSS `truncate` keeps the head. */
export function truncateTail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text
}
