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
  for (;;) {
    const line = await rl.question('> ')
    if (line.trim() === '') continue
    consoleHypha.feed(line)
  }
}
