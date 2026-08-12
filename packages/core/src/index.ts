import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { bootstrap, germinationBanner } from './mycelium.js'

const configFile = resolve(process.cwd(), 'mycelo.yaml')
const { registry } = await bootstrap(configFile)

console.log(`mycelium: ${germinationBanner(registry)}`)

// The console hypha is driven by stdin here and by feed() in tests. Nothing else in
// the core knows this method exists — it is not part of the Hypha contract, so it
// must be duck-typed like every other plugin-boundary crossing, never cast: a real
// channel plugin named 'console' with no feed() would otherwise throw unhandled on
// the first keystroke, inside this top-level for-await, killing the process.
function hasFeed(instance: unknown): instance is { feed(text: string, externalId?: string): void } {
  return typeof instance === 'object' && instance !== null
    && typeof (instance as Record<string, unknown>).feed === 'function'
}

// Test-fixture seam for speaking as different senders: `name> text` speaks as `name`, splitting
// on the first `>` only so later `>` characters stay part of the text; no prefix, or a blank
// name, keeps today's `local`.
export function parseSenderLine(line: string): { sender: string, text: string } {
  const i = line.indexOf('>')
  if (i === -1) return { sender: 'local', text: line.trim() }
  const sender = line.slice(0, i).trim()
  return { sender: sender === '' ? 'local' : sender, text: line.slice(i + 1).trim() }
}

const consoleInstance = registry.hyphae.find((h) => h.name === 'console')?.instance

if (!hasFeed(consoleInstance)) {
  console.log('no console hypha: nothing to read from')
} else {
  console.log('listening on console')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.setPrompt('> ')
  rl.prompt()
  // `for await` over the interface, not a repeated rl.question(): question() re-arms
  // a one-shot 'line' listener, but readline drains a whole buffered chunk
  // synchronously — a paste of several lines, or a fast pipe, fired every 'line' event
  // before the loop got back around to listening again, and all but the first were lost.
  for await (const line of rl) {
    if (line.trim() !== '') {
      const { sender, text } = parseSenderLine(line)
      if (text !== '') consoleInstance.feed(text, sender)
    }
    rl.prompt()
  }
}
