import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { runEntry, startupMessage } from './boot/entry.js'
import type { Running } from './boot/entry.js'
import { germinationBanner } from './mycelium.js'
import { parseSenderLine } from './support/sender.js'

const configFile = resolve(process.cwd(), 'mycelo.yaml')

let running: Running
try {
  running = await runEntry(configFile)
} catch (e) {
  console.error(startupMessage(e))
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void running.close().then(() => { process.exit(0) })
  })
}

const { germination } = running.state

if (germination.status === 'germinated') {
  console.log(`mycelium: ${germinationBanner(germination.mycelium.registry)}`)
} else {
  // germinatePhase has already logged why. Degraded mode has no registry, so there is no
  // hypha to drive and the API is the only way in (spec §8.1).
  console.log(`mycelium ${germination.status}: no channel to drive from stdin; use the API at ${running.address}`)
}

// The console hypha is driven by stdin here and by feed() in tests. Nothing else in
// the core knows this method exists — it is not part of the Hypha contract, so it
// must be duck-typed like every other plugin-boundary crossing, never cast: a real
// channel plugin named 'console' with no feed() would otherwise throw unhandled on
// the first keystroke, inside this top-level for-await, killing the process.
function hasFeed(instance: unknown): instance is {
  feed(text: string, externalId?: string, options?: { conversationId?: string, group?: { id: string, name?: string } }): void
} {
  return typeof instance === 'object' && instance !== null
    && typeof (instance as Record<string, unknown>).feed === 'function'
}

const consoleInstance = germination.status === 'germinated'
  ? germination.mycelium.registry.hyphae.find((h) => h.name === 'console')?.instance
  : undefined

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
      const { sender, group, text } = parseSenderLine(line)
      if (text !== '') {
        // The conversation id is the group id: a group's replies and its locale belong to
        // that conversation, not to the single 'stdin' one every DM shares.
        consoleInstance.feed(text, sender, group === undefined
          ? {}
          : { conversationId: group, group: { id: group, name: group } })
      }
    }
    rl.prompt()
  }
}
