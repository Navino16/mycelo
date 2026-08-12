export interface SenderLine {
  sender: string
  text: string
}

// Test-fixture seam for speaking as different senders: `name> text` speaks as `name`, splitting
// on the first `>` only so later `>` characters stay part of the text; no prefix, or a blank
// name, keeps today's `local`.
export function parseSenderLine(line: string): SenderLine {
  const i = line.indexOf('>')
  if (i === -1) return { sender: 'local', text: line.trim() }
  const sender = line.slice(0, i).trim()
  return { sender: sender === '' ? 'local' : sender, text: line.slice(i + 1).trim() }
}
