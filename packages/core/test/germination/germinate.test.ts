import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Logger } from '@mycelo/septum'
import { germinate } from '../../src/germination/germinate.js'
import { CollisionError } from '../../src/germination/registry.js'
import { createLogger } from '../../src/support/logger.js'

/** Records every warn() call instead of printing it, so a test can inspect them. */
function spyLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = []
  const logger: Logger = {
    debug() {}, info() {}, error() {},
    warn: (m) => { warnings.push(m) },
    child: () => logger,
  }
  return { logger, warnings }
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-germ-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function spore(name: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, name, rel)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content, 'utf8')
  }
}

it('refuses an instance that does not implement its kind', async () => {
  spore('liar', {
    'spore.yaml': 'kind: hypha\nname: liar\nseptum: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ start: 1 }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('create() returned no start, stop, send')
})

it('refuses a spore declaring requires, which phase 3 resolves', async () => {
  spore('needy', {
    'spore.yaml': 'kind: enzyme\nname: needy\nseptum: "^1.0"\ncommands:\n  - name: needy\n    description: x\n    respond: hi\nrequires:\n  - rhiza: radarr\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('phase 3')
})

it('keeps germinating after one spore fails', async () => {
  spore('broken', { 'spore.yaml': 'kind: [unclosed\n' })
  spore('ping', {
    'spore.yaml': 'kind: enzyme\nname: ping\nseptum: "^1.0"\ncommands:\n  - name: ping\n    description: x\n    respond: pong\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['ping'])
  expect(registry.dormant).toHaveLength(1)
})

it('propagates a command collision instead of swallowing it into a dormancy entry', async () => {
  // germinate() catches per-spore exceptions into `dormant`; a collision must escape
  // that net rather than being absorbed as if 'b' had merely failed to load (exit
  // criterion 4 — the core cannot know what it would be authorizing otherwise).
  spore('a', {
    'spore.yaml': 'kind: enzyme\nname: a\nseptum: "^1.0"\ncommands:\n  - name: status\n    description: x\n    respond: from-a\n',
  })
  spore('b', {
    'spore.yaml': 'kind: enzyme\nname: b\nseptum: "^1.0"\ncommands:\n  - name: status\n    description: x\n    respond: from-b\n',
  })
  try {
    await germinate(dir, createLogger())
    expect.unreachable()
  } catch (e) {
    expect(e).toBeInstanceOf(CollisionError)
    const error = e as CollisionError
    expect(error.plugins).toEqual(['a', 'b'])
    expect(error.message).toContain('a')
    expect(error.message).toContain('b')
  }
})

it('warns naming the resolved path when the spores directory does not exist', async () => {
  const missing = join(dir, 'does-not-exist')
  const { logger, warnings } = spyLogger()
  const registry = await germinate(missing, logger)
  expect(registry.hyphae).toEqual([])
  expect(warnings.some((w) => w.includes(missing))).toBe(true)
})

it('warns when germination produces zero spores, even though the directory exists', async () => {
  const { logger, warnings } = spyLogger()
  const registry = await germinate(dir, logger)
  expect(registry.hyphae).toEqual([])
  expect(registry.enzymes).toEqual([])
  expect(warnings.some((w) => w.includes('zero spores'))).toBe(true)
})

const HYPHA_BODY = 'start: async () => {}, stop: async () => {}, send: async () => {}'

it('sends the second of two hyphae sharing a manifest name dormant, naming both directories', async () => {
  spore('first-copy', {
    'spore.yaml': 'kind: hypha\nname: duplicated\nseptum: "^1.0"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  spore('second-copy', {
    'spore.yaml': 'kind: hypha\nname: duplicated\nseptum: "^1.0"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.hyphae.map((h) => h.name)).toEqual(['duplicated'])
  const dormant = registry.dormant.find((d) => d.name === 'duplicated')
  expect(dormant?.reason).toContain('first-copy')
  expect(dormant?.reason).toContain('second-copy')
})

it('sends the second of two enzymes sharing a manifest name dormant, naming both directories', async () => {
  spore('alpha-enzyme', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^1.0"\ncommands:\n  - name: a\n    description: x\n    respond: from-alpha\n',
  })
  spore('beta-enzyme', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^1.0"\ncommands:\n  - name: b\n    description: x\n    respond: from-beta\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['shared'])
  const dormant = registry.dormant.find((d) => d.name === 'shared')
  expect(dormant?.reason).toContain('alpha-enzyme')
  expect(dormant?.reason).toContain('beta-enzyme')
})

it('sends a hypha dormant when it declares group_membership but has no listGroupMembers(), matching the conformance kit', async () => {
  spore('deceptive', {
    'spore.yaml': 'kind: hypha\nname: deceptive\nseptum: "^1.0"\ncapabilities:\n  - group_membership\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('no listGroupMembers()')
})

it('sends a hypha dormant when it has listGroupMembers() but does not declare group_membership, matching the conformance kit', async () => {
  spore('secretive', {
    'spore.yaml': 'kind: hypha\nname: secretive\nseptum: "^1.0"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY}, listGroupMembers: async () => [] }) }\n`,
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('does not declare group_membership')
})

it('refuses an enzyme whose handlers lack a name the manifest references', async () => {
  spore('broken', {
    'spore.yaml': 'kind: enzyme\nname: broken\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: handleGo\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('handleGo')
})

it('names a missing handler once even when two commands share it', async () => {
  spore('shared', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^1.0"\ncommands:\n  - name: add\n    description: Add\n    code: mutate\n  - name: remove\n    description: Remove\n    code: mutate\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.dormant[0]?.reason).toMatch(/mutate/)
  expect(registry.dormant[0]?.reason.match(/mutate/g)).toHaveLength(1)
})

it('warns about a handler no command references, and still germinates', async () => {
  spore('dead', {
    'spore.yaml': 'kind: enzyme\nname: dead\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: handleGo\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { handleGo: async () => {}, leftover: async () => {} } }) }\n',
  })
  const warnings: string[] = []
  const logger = createLogger()
  const registry = await germinate(dir, { ...logger, warn: (m) => { warnings.push(m) } })
  expect(registry.enzymes.map((e) => e.name)).toEqual(['dead'])
  expect(warnings.join(' ')).toContain('leftover')
})

it('says the module is unreachable, not naming handlers, when every command answers with text', async () => {
  spore('unreachable', {
    'spore.yaml': 'kind: enzyme\nname: unreachable\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    respond: gone\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { leftover: async () => {} } }) }\n',
  })
  const warnings: string[] = []
  const logger = createLogger()
  const registry = await germinate(dir, { ...logger, warn: (m) => { warnings.push(m) } })
  expect(registry.dormant).toEqual([])
  expect(registry.enzymes.map((e) => e.name)).toEqual(['unreachable'])
  expect(warnings.join(' ')).toContain('the module is unreachable')
  expect(warnings.join(' ')).not.toContain('leftover')
  // Still answers: the route resolves through `respond`, untouched by the dead handler.
  expect(registry.routes.get('go')?.spec.respond).toBe('gone')
})

it('goes dormant on a command named "constructor" with no such handler, not Object.prototype.constructor', async () => {
  spore('sneaky', {
    'spore.yaml': 'kind: enzyme\nname: sneaky\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: constructor\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('constructor')
})

it('goes dormant on a command named "toString" with no such handler, not Object.prototype.toString', async () => {
  spore('sneaky2', {
    'spore.yaml': 'kind: enzyme\nname: sneaky2\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: toString\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('toString')
})

it('refuses an enzyme whose instance has start() but no stop(), matching the conformance kit', async () => {
  spore('lopsided', {
    'spore.yaml': 'kind: enzyme\nname: lopsided\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: go\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { go: async () => {} }, start: async () => {} }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('both present or both absent')
})

it('germinates when the handler is genuinely declared and named "constructor"', async () => {
  spore('legit', {
    'spore.yaml': 'kind: enzyme\nname: legit\nseptum: "^1.0"\ncommands:\n  - name: go\n    description: Go\n    code: constructor\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { constructor: async () => {} } }) }\n',
  })
  const registry = await germinate(dir, createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['legit'])
  expect(registry.dormant).toEqual([])
})
