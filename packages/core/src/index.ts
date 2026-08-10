import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { bootstrap } from './mycelium.js'

const configFile = resolve(process.cwd(), 'mycelo.yaml')
const { registry } = await bootstrap(configFile)

const names = [...registry.hyphae, ...registry.enzymes].map((s) => s.name).join(', ')
console.log(`mycelium: germinated ${String(registry.hyphae.length + registry.enzymes.length)} spores (${names})`)

// The console hypha is driven by stdin here and by feed() in tests. Nothing else in
// the core knows this method exists — it is not part of the Hypha contract.
const consoleHypha = registry.hyphae.find((h) => h.name === 'console')?.instance as
  | { feed(text: string): void }
  | undefined

if (consoleHypha === undefined) {
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
    if (line.trim() !== '') consoleHypha.feed(line)
    rl.prompt()
  }
}
