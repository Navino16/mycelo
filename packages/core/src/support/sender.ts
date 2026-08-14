export interface SenderLine {
  sender: string
  /** Group id when the line named one, absent for a direct message. */
  group?: string
  text: string
}

// Test-fixture seam for speaking as different senders and from different conversations:
// `name> text` speaks as `name` in a DM, `name@group> text` in that group. Split on the
// first `>` only, so later `>` characters stay part of the text.
export function parseSenderLine(line: string): SenderLine {
  const i = line.indexOf('>')
  if (i === -1) return { sender: 'local', text: line.trim() }
  const head = line.slice(0, i).trim()
  const text = line.slice(i + 1).trim()
  const at = head.indexOf('@')
  const name = (at === -1 ? head : head.slice(0, at)).trim()
  const group = at === -1 ? '' : head.slice(at + 1).trim()
  return {
    sender: name === '' ? 'local' : name,
    ...(group === '' ? {} : { group }),
    text,
  }
}
