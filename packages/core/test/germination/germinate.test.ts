import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { defineConfig, SEPTUM_VERSION, type ConfigSchema, type EnzymeContext, type Logger } from '@mycelo/septum'
import { enzymeChecks, type EnzymeHarness } from '@mycelo/septum/conformance'
import { z } from 'zod'
import { undeclaredSecretKeys } from '../../src/config/plugins.js'
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
    'spore.yaml': 'kind: hypha\nname: liar\nseptum: "^0.11"\n',
    'src/index.ts': 'export default { create: () => ({ start: 1 }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('create() returned no connect, listen, stop, send')
})

it('leaves a spore dormant when a declared requires target is not installed', async () => {
  spore('needy', {
    'spore.yaml': 'kind: enzyme\nname: needy\nseptum: "^0.11"\ncommands:\n  - name: needy\n    description: x\n    respond: hi\nrequires:\n  - rhiza: radarr\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain("requires rhiza 'radarr', which is not installed")
})

it('germinates an inhibitor instead of refusing its kind', async () => {
  spore('gatefix', {
    'spore.yaml': 'kind: inhibitor\nname: gatefix\nseptum: "^0.11"\nenforcing: true\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.dormant).toEqual([])
  expect(registry.inhibitors.map((i) => i.name)).toEqual(['gatefix'])
  expect(registry.inhibitors[0]?.manifest.enforcing).toBe(true)
})

it('leaves an inhibitor with no inspect() dormant', async () => {
  spore('badgate', {
    'spore.yaml': 'kind: inhibitor\nname: badgate\nseptum: "^0.11"\n',
    'src/index.ts': 'export default { create: () => ({}) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('inspect')
  // 'badgate' declares no `enforcing`, so its own shape failure must not fail closed.
  expect(registry.brokenEnforcing).toEqual([])
})

it('refuses all traffic when an enforcing inhibitor has a shape failure', async () => {
  spore('shapegate', {
    'spore.yaml': 'kind: inhibitor\nname: shapegate\nseptum: "^0.11"\nenforcing: true\n',
    'src/index.ts': 'export default { create: () => ({}) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual(['shapegate'])
})

it('refuses all traffic when an enforcing inhibitor throws on module load', async () => {
  spore('throwloadgate', {
    'spore.yaml': 'kind: inhibitor\nname: throwloadgate\nseptum: "^0.11"\nenforcing: true\n',
    'src/index.ts': 'throw new Error("import explodes")\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual(['throwloadgate'])
})

it('does not refuse all traffic when an advisory inhibitor throws on module load', async () => {
  spore('throwloadgate2', {
    'spore.yaml': 'kind: inhibitor\nname: throwloadgate2\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("import explodes")\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual([])
})

it('refuses all traffic when an enforcing inhibitor throws in create()', async () => {
  spore('throwcreategate', {
    'spore.yaml': 'kind: inhibitor\nname: throwcreategate\nseptum: "^0.11"\nenforcing: true\n',
    'src/index.ts': 'export default { create: () => { throw new Error("create explodes") } }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual(['throwcreategate'])
})

it('refuses all traffic when an enforcing inhibitor has a dormant mandatory dependency', async () => {
  spore('brokenstore', {
    'spore.yaml': 'kind: rhiza\nname: brokenstore\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("store explodes")\n',
  })
  spore('depgate', {
    'spore.yaml': 'kind: inhibitor\nname: depgate\nseptum: "^0.11"\nenforcing: true\nrequires:\n  - rhiza: brokenstore\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual(['depgate'])
})

it('does not refuse all traffic when an advisory inhibitor has a dormant mandatory dependency', async () => {
  spore('brokenstore', {
    'spore.yaml': 'kind: rhiza\nname: brokenstore\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("store explodes")\n',
  })
  spore('depgate2', {
    'spore.yaml': 'kind: inhibitor\nname: depgate2\nseptum: "^0.11"\nrequires:\n  - rhiza: brokenstore\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'depgate2')).toBeDefined()
  expect(registry.brokenEnforcing).toEqual([])
})

it('refuses all traffic when an enforcing inhibitor is dormant from a rejected config', async () => {
  spore('strictgate', {
    'spore.yaml': 'kind: inhibitor\nname: strictgate\nseptum: "^0.11"\nenforcing: true\n',
    'src/index.ts': [
      'export default {',
      '  configSchema: { safeParse: () => ({ success: false, error: { issues: [{ path: ["groupId"], message: "groupId is required" }] } }) },',
      '  create: () => ({ inspect: () => Promise.resolve({ allow: true }) }),',
      '}',
    ].join('\n'),
  })
  const registry = await germinate([dir], createLogger(), {})
  expect(registry.inhibitors).toEqual([])
  expect(registry.brokenEnforcing).toEqual(['strictgate'])
})

it('does not refuse all traffic when a dormant inhibitor is only advisory', async () => {
  spore('softgate', {
    'spore.yaml': 'kind: inhibitor\nname: softgate\nseptum: "^0.11"\n',
    'src/index.ts': [
      'export default {',
      '  configSchema: { safeParse: () => ({ success: false, error: { issues: [{ path: ["groupId"], message: "groupId is required" }] } }) },',
      '  create: () => ({ inspect: () => Promise.resolve({ allow: true }) }),',
      '}',
    ].join('\n'),
  })
  const registry = await germinate([dir], createLogger(), {})
  expect(registry.dormant).toHaveLength(1)
  expect(registry.brokenEnforcing).toEqual([])
})

// Every other brokenEnforcing test uses a valid manifest, so a typo in spore.yaml was the
// one path to dormancy that left the guarded channel open with only a warning (design §7).
it('refuses all traffic when an enforcing inhibitor\'s manifest does not parse', async () => {
  spore('typogate', {
    'spore.yaml': 'kind: inhibitor\nname: typogate\nenforcing: true\nseptem: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.inhibitors).toEqual([])
  // No validated name exists, so the directory is what identifies it.
  expect(registry.brokenEnforcing).toEqual(['typogate'])
})

it('does not refuse all traffic when an unparseable manifest is not an enforcing inhibitor', async () => {
  spore('typosoft', {
    'spore.yaml': 'kind: inhibitor\nname: typosoft\nseptem: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  spore('typoenzyme', {
    'spore.yaml': 'kind: enzyme\nname: typoenzyme\nenforcing: true\nseptem: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.dormant).toHaveLength(2)
  expect(registry.brokenEnforcing).toEqual([])
})

it('does not read a truthy-but-not-true enforcing out of an unvalidated manifest', async () => {
  spore('sneakygate', {
    'spore.yaml': 'kind: inhibitor\nname: sneakygate\nenforcing: "yes"\nseptem: "^1.0"\n',
    'src/index.ts': 'export default { create: () => ({ inspect: () => Promise.resolve({ allow: true }) }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.brokenEnforcing).toEqual([])
})

it('makes a dependent dormant when a MANDATORY dependency fails to load, never importing its own module', async () => {
  // Marker written at import time, not inside create(): proves the module was never
  // loaded, rather than merely that the spore ended up dormant.
  const marker = join(dir, 'needs-it-loaded')
  spore('broken-rhiza', {
    'spore.yaml': 'kind: rhiza\nname: broken-rhiza\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("module explodes")\n',
  })
  spore('needs-it', {
    'spore.yaml': 'kind: enzyme\nname: needs-it\nseptum: "^0.11"\nrequires:\n  - rhiza: broken-rhiza\ncommands:\n  - name: hi\n    description: x\n    respond: hi\n',
    'src/index.ts': `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'loaded')\nexport default { create: () => ({ handlers: {} }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'needs-it')?.reason)
    .toContain("requires rhiza 'broken-rhiza', which is dormant")
  expect(existsSync(marker)).toBe(false)
})

it('keeps a dependent germinating when an OPTIONAL dependency fails to load', async () => {
  spore('broken-rhiza', {
    'spore.yaml': 'kind: rhiza\nname: broken-rhiza\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("module explodes")\n',
  })
  spore('shrugs-it-off', {
    'spore.yaml': 'kind: enzyme\nname: shrugs-it-off\nseptum: "^0.11"\nrequires:\n  - rhiza: broken-rhiza\n    optional: true\ncommands:\n  - name: hi\n    description: x\n    respond: hi\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['shrugs-it-off'])
  expect(registry.dormant.find((d) => d.name === 'shrugs-it-off')).toBeUndefined()
})

// Deliberate: re-collapsing would invalidate the topological order (design §2.2).
it('does not fall back to a healthy any_of alternative when the chosen one fails to load', async () => {
  spore('alpha', {
    'spore.yaml': 'kind: rhiza\nname: alpha\nseptum: "^0.11"\n',
    'src/index.ts': 'throw new Error("alpha explodes")\n',
  })
  spore('beta', {
    'spore.yaml': 'kind: rhiza\nname: beta\nseptum: "^0.11"\n',
    'src/index.ts': 'export default { create: () => ({ start: async () => {}, stop: async () => {}, health: async () => "healthy", api: {} }) }\n',
  })
  spore('picks-one', {
    'spore.yaml': 'kind: enzyme\nname: picks-one\nseptum: "^0.11"\nrequires:\n  - any_of:\n      - rhiza: alpha\n      - rhiza: beta\ncommands:\n  - name: hi\n    description: x\n    respond: hi\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.rhizas.map((r) => r.name)).toEqual(['beta'])
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'picks-one')?.reason).toBe(
    "requires one of rhiza 'alpha', 'beta'; 'alpha' was chosen and is dormant: alpha explodes",
  )
})

const RHIZA_BODY = 'start: async () => {}, stop: async () => {}, health: async () => "healthy", api: {}'

it('germinates a valid rhiza into registry.rhizas', async () => {
  spore('valid-rhiza', {
    'spore.yaml': 'kind: rhiza\nname: valid-rhiza\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${RHIZA_BODY} }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.rhizas.map((r) => r.name)).toEqual(['valid-rhiza'])
  expect(registry.dormant).toEqual([])
})

it('sends a rhiza dormant when create() returns no api, matching the conformance kit', async () => {
  spore('no-api', {
    'spore.yaml': 'kind: rhiza\nname: no-api\nseptum: "^0.11"\n',
    'src/index.ts': 'export default { create: () => ({ start: async () => {}, stop: async () => {}, health: async () => "healthy" }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.rhizas).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('no api')
})

it('keeps germinating after one spore fails', async () => {
  spore('broken', { 'spore.yaml': 'kind: [unclosed\n' })
  spore('ping', {
    'spore.yaml': 'kind: enzyme\nname: ping\nseptum: "^0.11"\ncommands:\n  - name: ping\n    description: x\n    respond: pong\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['ping'])
  expect(registry.dormant).toHaveLength(1)
})

it('propagates a command collision instead of swallowing it into a dormancy entry', async () => {
  // germinate() catches per-spore exceptions into `dormant`; a collision must escape
  // that net rather than being absorbed as if 'b' had merely failed to load (exit
  // criterion 4 — the core cannot know what it would be authorizing otherwise).
  spore('a', {
    'spore.yaml': 'kind: enzyme\nname: a\nseptum: "^0.11"\ncommands:\n  - name: status\n    description: x\n    respond: from-a\n',
  })
  spore('b', {
    'spore.yaml': 'kind: enzyme\nname: b\nseptum: "^0.11"\ncommands:\n  - name: status\n    description: x\n    respond: from-b\n',
  })
  try {
    await germinate([dir], createLogger())
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
  const registry = await germinate([missing], logger)
  expect(registry.hyphae).toEqual([])
  expect(warnings.some((w) => w.includes(missing))).toBe(true)
})

it('warns when germination produces zero spores, even though the directory exists', async () => {
  const { logger, warnings } = spyLogger()
  const registry = await germinate([dir], logger)
  expect(registry.hyphae).toEqual([])
  expect(registry.enzymes).toEqual([])
  expect(warnings.some((w) => w.includes('zero spores'))).toBe(true)
})

const HYPHA_BODY = 'connect: async () => {}, listen: () => {}, stop: async () => {}, send: async () => {}'

it('sends the second of two hyphae sharing a manifest name dormant, naming both directories', async () => {
  spore('first-copy', {
    'spore.yaml': 'kind: hypha\nname: duplicated\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  spore('second-copy', {
    'spore.yaml': 'kind: hypha\nname: duplicated\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.hyphae.map((h) => h.name)).toEqual(['duplicated'])
  const dormant = registry.dormant.find((d) => d.name === 'duplicated')
  expect(dormant?.reason).toContain('first-copy')
  expect(dormant?.reason).toContain('second-copy')
})

it('sends the second of two enzymes sharing a manifest name dormant, naming both directories', async () => {
  spore('alpha-enzyme', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^0.11"\ncommands:\n  - name: a\n    description: x\n    respond: from-alpha\n',
  })
  spore('beta-enzyme', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^0.11"\ncommands:\n  - name: b\n    description: x\n    respond: from-beta\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['shared'])
  const dormant = registry.dormant.find((d) => d.name === 'shared')
  expect(dormant?.reason).toContain('alpha-enzyme')
  expect(dormant?.reason).toContain('beta-enzyme')
})

it('sends a hypha dormant when it declares group_membership but has no listGroupMembers(), matching the conformance kit', async () => {
  spore('deceptive', {
    'spore.yaml': 'kind: hypha\nname: deceptive\nseptum: "^0.11"\ncapabilities:\n  - group_membership\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY} }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('no listGroupMembers()')
})

it('sends a hypha dormant when it has listGroupMembers() but does not declare group_membership, matching the conformance kit', async () => {
  spore('secretive', {
    'spore.yaml': 'kind: hypha\nname: secretive\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${HYPHA_BODY}, listGroupMembers: async () => [] }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.hyphae).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('does not declare group_membership')
})

it('refuses an enzyme whose handlers lack a name the manifest references', async () => {
  spore('broken', {
    'spore.yaml': 'kind: enzyme\nname: broken\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: handleGo\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('handleGo')
})

it('names a missing handler once even when two commands share it', async () => {
  spore('shared', {
    'spore.yaml': 'kind: enzyme\nname: shared\nseptum: "^0.11"\ncommands:\n  - name: add\n    description: Add\n    code: mutate\n  - name: remove\n    description: Remove\n    code: mutate\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.dormant[0]?.reason).toMatch(/mutate/)
  expect(registry.dormant[0]?.reason.match(/mutate/g)).toHaveLength(1)
})

it('warns about a handler no command references, and still germinates', async () => {
  spore('dead', {
    'spore.yaml': 'kind: enzyme\nname: dead\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: handleGo\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { handleGo: async () => {}, leftover: async () => {} } }) }\n',
  })
  const warnings: string[] = []
  const logger = createLogger()
  const registry = await germinate([dir], { ...logger, warn: (m) => { warnings.push(m) } })
  expect(registry.enzymes.map((e) => e.name)).toEqual(['dead'])
  expect(warnings.join(' ')).toContain('leftover')
})

it('says the module is unreachable, not naming handlers, when every command answers with text', async () => {
  spore('unreachable', {
    'spore.yaml': 'kind: enzyme\nname: unreachable\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    respond: gone\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { leftover: async () => {} } }) }\n',
  })
  const warnings: string[] = []
  const logger = createLogger()
  const registry = await germinate([dir], { ...logger, warn: (m) => { warnings.push(m) } })
  expect(registry.dormant).toEqual([])
  expect(registry.enzymes.map((e) => e.name)).toEqual(['unreachable'])
  expect(warnings.join(' ')).toContain('the module is unreachable')
  expect(warnings.join(' ')).not.toContain('leftover')
  // Still answers: the route resolves through `respond`, untouched by the dead handler.
  expect(registry.routes.get('go')?.spec.respond).toBe('gone')
})

it('goes dormant on a command named "constructor" with no such handler, not Object.prototype.constructor', async () => {
  spore('sneaky', {
    'spore.yaml': 'kind: enzyme\nname: sneaky\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: constructor\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('constructor')
})

it('goes dormant on a command named "toString" with no such handler, not Object.prototype.toString', async () => {
  spore('sneaky2', {
    'spore.yaml': 'kind: enzyme\nname: sneaky2\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: toString\n',
    'src/index.ts': 'export default { create: () => ({ handlers: {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('toString')
})

it('refuses an enzyme whose instance has start() but no stop(), matching the conformance kit', async () => {
  spore('lopsided', {
    'spore.yaml': 'kind: enzyme\nname: lopsided\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: go\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { go: async () => {} }, start: async () => {} }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('both present or both absent')
})

it('germinates when the handler is genuinely declared and named "constructor"', async () => {
  spore('legit', {
    'spore.yaml': 'kind: enzyme\nname: legit\nseptum: "^0.11"\ncommands:\n  - name: go\n    description: Go\n    code: constructor\n',
    'src/index.ts': 'export default { create: () => ({ handlers: { constructor: async () => {} } }) }\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes.map((e) => e.name)).toEqual(['legit'])
  expect(registry.dormant).toEqual([])
})

const CONFIGURABLE_RHIZA_MODULE = `
  export default {
    // Duck-typed on purpose: a real spore is bundled with its own Zod.
    configSchema: { safeParse: (input) => {
      // undefined and {} are reported differently on purpose: without it, dropping
      // germinate()'s \`?? {}\` would leave the absent-key test green.
      if (input === undefined) return { success: false, error: { issues: [{ path: [], message: 'config was passed as undefined' }] } }
      const token = input === null || typeof input !== 'object' ? undefined : input.token
      return typeof token === 'string'
        ? { success: true, data: { token } }
        : { success: false, error: { issues: [{ path: ['token'], message: 'token must be a string' }] } }
    } },
    create: () => ({ ${RHIZA_BODY} }),
  }
`

function confRhiza(): void {
  spore('confrhiza', {
    'spore.yaml': 'kind: rhiza\nname: confrhiza\nseptum: "^0.11"\n',
    'src/index.ts': CONFIGURABLE_RHIZA_MODULE,
  })
}

it('serves a spore its config from mycelo.yaml', async () => {
  confRhiza()
  const registry = await germinate([dir], createLogger(), { confrhiza: { token: 'abc' } })
  expect(registry.dormant).toEqual([])
  expect(registry.rhizas[0]?.config).toEqual({ token: 'abc' })
})

it('leaves a spore dormant, with the reason, when its config is rejected', async () => {
  confRhiza()
  const registry = await germinate([dir], createLogger(), { confrhiza: { token: 42 } })
  expect(registry.rhizas).toEqual([])
  expect(registry.dormant[0]?.reason).toContain('token must be a string')
})

it('rejects a spore whose config key is absent entirely, rather than passing undefined', async () => {
  confRhiza()
  const registry = await germinate([dir], createLogger(), {})
  expect(registry.rhizas).toEqual([])
  // The absent key must arrive as {}, so the schema's own undefined branch stays unreached.
  expect(registry.dormant[0]?.reason).toContain('token must be a string')
  expect(registry.dormant[0]?.reason).not.toContain('passed as undefined')
})

it('gives a spore with no configSchema an empty config', async () => {
  spore('plainrhiza', {
    'spore.yaml': 'kind: rhiza\nname: plainrhiza\nseptum: "^0.11"\n',
    'src/index.ts': `export default { create: () => ({ ${RHIZA_BODY} }) }\n`,
  })
  const registry = await germinate([dir], createLogger(), {})
  expect(registry.rhizas[0]?.config).toEqual({})
})

const HAND_ROLLED = `
  export default {
    configSchema: {
      safeParse: (input) => ({ success: true, data: input ?? {} }),
      toJsonSchema: () => ({ type: 'object', properties: { url: {} } }),
      secrets: ['apiKye'],
    },
    create: () => ({ handlers: {} }),
  }
`

// If this string ever drifts, the replace below silently no-ops and the 'sound' fixture
// would carry the same typo'd secret as 'typo' — the anchor is asserted, not assumed.
if (!HAND_ROLLED.includes("secrets: ['apiKye']")) throw new Error('HAND_ROLLED anchor text has drifted')
const SOUND_MODULE = HAND_ROLLED.replace("secrets: ['apiKye']", "secrets: ['url']")

it('a spore declaring a secret its schema does not have is dormant, and the reason names the key', async () => {
  spore('typo', {
    'spore.yaml': 'kind: enzyme\nname: typo\nseptum: "^0.11"\ncommands:\n  - name: typo\n    description: x\n    respond: hi\n',
    'src/index.ts': HAND_ROLLED,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  const entry = registry.dormant.find((d) => d.name === 'typo')
  expect(entry).toBeDefined()
  expect(entry?.reason).toContain('apiKye')
  expect(entry?.reason).toContain('declares a secret')
})

// The cardinality case: `undeclaredSecretKeys` reduced to its first element survives every
// singular test, and an operator would fix one typo, restart, and meet the next.
it('a spore declaring two undeclared secrets is dormant, and the reason names both', async () => {
  const twoTypos = HAND_ROLLED.replace("secrets: ['apiKye']", "secrets: ['apiKye', 'secrit']")
  if (twoTypos === HAND_ROLLED) throw new Error('HAND_ROLLED anchor text has drifted')
  spore('typos', {
    'spore.yaml': 'kind: enzyme\nname: typos\nseptum: "^0.11"\ncommands:\n  - name: typos\n    description: x\n    respond: hi\n',
    'src/index.ts': twoTypos,
  })
  const registry = await germinate([dir], createLogger())
  const entry = registry.dormant.find((d) => d.name === 'typos')
  expect(entry?.reason).toContain('apiKye')
  expect(entry?.reason).toContain('secrit')
  expect(entry?.reason).toContain('declares secrets')
})

it('a spore whose secret names a declared field germinates', async () => {
  spore('sound', {
    'spore.yaml': 'kind: enzyme\nname: sound\nseptum: "^0.11"\ncommands:\n  - name: sound\n    description: x\n    respond: hi\n',
    'src/index.ts': SOUND_MODULE,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.dormant).toEqual([])
  expect(registry.enzymes.map((e) => e.name)).toEqual(['sound'])
})

/** Minimal but real: `EnzymeContext` an author would hand the kit, never invoked here
 *  since every command below answers via `respond:` and no handler runs. */
function pinContext(): EnzymeContext<unknown> {
  return {
    config: {},
    logger: { debug() {}, info() {}, warn() {}, error() {}, child: () => pinContext().logger },
    async reply() {},
    async push() {},
    rhiza: <T,>() => ({}) as T,
    has: () => false,
    capabilities: { has: () => true, list: () => [] },
    capabilitiesOf: () => ({ has: () => true, list: () => [] }),
    principal: { id: 'p1', identities: [], roles: [] },
    locale: 'en',
    on() {},
    t: (key) => (typeof key === 'string' ? key : key.key),
    localeFor: () => Promise.resolve('en'),
  }
}

function pinHarness(configSchema: ConfigSchema<unknown>): EnzymeHarness {
  return {
    name: 'pin-check',
    manifest: {
      kind: 'enzyme',
      name: 'pin-check',
      septum: '^0.11',
      commands: [{ name: 'pin-check', description: 'x', respond: 'hi' }],
    },
    module: { configSchema, create: () => ({ handlers: {} }) },
    context: pinContext,
  }
}

/** Through `enzymeChecks`, the kit's public entry point — not its module-private rule. */
async function kitUndeclaredSecretKeys(schema: ConfigSchema<unknown>): Promise<string[]> {
  const failures = await enzymeChecks(pinHarness(schema))
  const named = /^configSchema\.secrets names '(.+)', which the schema does not declare$/
  return failures.flatMap((f) => named.exec(f)?.[1] ?? [])
}

// Two implementations of one rule (plugins.ts and septum's kit) is exactly the desync a
// prior mutation punished elsewhere in this project: compute the agreement through the kit's
// public surface, do not restate two literal lists that could drift together unnoticed.
it('agrees with the conformance kit on which secret keys are undeclared', async () => {
  const passthrough = (input: unknown): { success: true, data: unknown } => ({ success: true, data: input })
  const sound: ConfigSchema<unknown> = {
    safeParse: passthrough,
    toJsonSchema: () => ({ type: 'object', properties: { url: {} } }),
    secrets: ['url'],
  }
  const undeclared: ConfigSchema<unknown> = {
    safeParse: (input) => ({ success: true, data: input }),
    toJsonSchema: () => ({ type: 'object', properties: {} }),
    secrets: ['apiKey'],
  }
  const noJsonSchema: ConfigSchema<unknown> = {
    safeParse: (input) => ({ success: true, data: input }),
    secrets: ['apiKey'],
  }
  const loose = defineConfig(z.looseObject({ url: z.string() }), { secrets: ['apiKey'] })
  // Four shapes no compiler stops a JavaScript plugin from writing. The core answers [] for each;
  // the kit used to throw on two of them and name '42' as a key on a third.
  const closed = () => ({ type: 'object', properties: { url: {} } })
  const stringSecrets = { safeParse: passthrough, secrets: 'token', toJsonSchema: closed }
  const numberEntry = { safeParse: passthrough, secrets: ['url', 42], toJsonSchema: closed }
  const thenable = { safeParse: passthrough, secrets: ['apiKey'], toJsonSchema: () => ({ then: () => {}, properties: {} }) }
  const throwingGetter = {
    safeParse: passthrough,
    secrets: ['apiKey'],
    get toJsonSchema(): unknown { throw new Error('boom') },
  }

  const malformed = [stringSecrets, numberEntry, thenable, throwingGetter]
    .map((s) => s as unknown as ConfigSchema<unknown>)
  for (const schema of [sound, undeclared, noJsonSchema, loose, ...malformed]) {
    expect(undeclaredSecretKeys(schema)).toEqual(await kitUndeclaredSecretKeys(schema))
  }
})

function textEnzyme(name: string): Record<string, string> {
  return { 'spore.yaml': `kind: enzyme\nname: ${name}\nseptum: "^0.11"\ncommands:\n  - name: ${name}\n    description: x\n    respond: hi\n` }
}

it('loads a spore\'s catalogues into the registry, keyed by the spore name', async () => {
  spore('greeter', {
    ...textEnzyme('greeter'),
    'translations/en.yaml': 'ready: ready\n',
    'translations/fr.yaml': 'ready: prêt\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.catalogs.get('greeter')?.get('fr')?.get('ready')?.format()).toBe('prêt')
})

it('makes a spore dormant when one of its catalogues does not compile, naming file and key', async () => {
  spore('greeter', {
    ...textEnzyme('greeter'),
    'translations/en.yaml': 'ready: ready\n',
    'translations/es.yaml': 'ready: "type {help"\n',
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toHaveLength(0)
  const reason = registry.dormant.find((d) => d.name === 'greeter')?.reason ?? ''
  expect(reason).toContain('es.yaml')
  expect(reason).toContain('ready')
})

it('drops a dormant spore\'s catalogue instead of keeping it from before the failure', async () => {
  spore('confrhiza', {
    'spore.yaml': 'kind: rhiza\nname: confrhiza\nseptum: "^0.11"\n',
    'src/index.ts': CONFIGURABLE_RHIZA_MODULE,
    'translations/en.yaml': 'ready: ready\n',
  })
  const registry = await germinate([dir], createLogger(), { confrhiza: { token: 42 } })
  expect(registry.rhizas).toEqual([])
  expect(registry.catalogs.has('confrhiza')).toBe(false)
})

it('germinates a spore with no translations directory at all', async () => {
  spore('greeter', textEnzyme('greeter'))
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toHaveLength(1)
  expect(registry.catalogs.has('greeter')).toBe(false)
})

it('makes a MANDATORY dependent dormant when a broken catalogue fails a rhiza, never importing its own module', async () => {
  // Marker written at import time, mirroring the module-load-failure cascade test above:
  // proves the dependent never got far enough to load, not merely that it ended up dormant.
  const marker = join(dir, 'needs-broken-loaded')
  spore('broken-rhiza', {
    'spore.yaml': 'kind: rhiza\nname: broken-rhiza\nseptum: "^0.11"\n',
    'src/index.ts': 'export default { create: () => ({ ping: async () => "pong" }) }\n',
    'translations/es.yaml': 'ready: "type {help"\n',
  })
  spore('needs-it', {
    'spore.yaml': 'kind: enzyme\nname: needs-it\nseptum: "^0.11"\nrequires:\n  - rhiza: broken-rhiza\ncommands:\n  - name: hi\n    description: x\n    respond: hi\n',
    'src/index.ts': `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'loaded')\nexport default { create: () => ({ handlers: {} }) }\n`,
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  expect(registry.dormant.find((d) => d.name === 'needs-it')?.reason)
    .toContain("requires rhiza 'broken-rhiza', which is dormant")
  expect(existsSync(marker)).toBe(false)
})

it('refuses a spore that claims a reserved domain name', async () => {
  for (const reserved of ['core', 'common']) {
    spore(reserved, textEnzyme(reserved))
    const registry = await germinate([dir], createLogger())
    // Both, not one: a guard written against a single literal is the cardinality mutation
    // phase 5.5's campaign kept surviving.
    expect(registry.dormant.find((d) => d.name === reserved)?.reason).toContain('reserved')
  }
})

it('leaves a spore dormant when its septum range excludes the running septum, naming both', async () => {
  spore('stale', {
    'spore.yaml': [
      'kind: enzyme',
      'name: stale',
      'septum: "^0.9"',
      'commands:',
      '  - name: hi',
      '    description: command.hi.description',
      '    respond: reply.hi',
    ].join('\n'),
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.enzymes).toEqual([])
  const dormant = registry.dormant.find((d) => d.name === 'stale')
  expect(dormant?.reason).toContain('^0.9')
  expect(dormant?.reason).toContain(SEPTUM_VERSION)
})

it('germinates a spore whose septum range covers the running septum', async () => {
  // The positive beside the negative: without it the test above passes on any dormancy.
  spore('fresh', {
    'spore.yaml': [
      'kind: enzyme',
      `name: fresh`,
      `septum: ">=${SEPTUM_VERSION}"`,
      'commands:',
      '  - name: hi',
      '    description: command.hi.description',
      '    respond: reply.hi',
    ].join('\n'),
  })
  const registry = await germinate([dir], createLogger())
  expect(registry.dormant).toEqual([])
  expect(registry.enzymes.map((e) => e.name)).toEqual(['fresh'])
})
