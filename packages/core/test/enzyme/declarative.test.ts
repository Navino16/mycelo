import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { EnzymeContext, Invocation } from '@mycelo/septum'
import { hasDeclarativeEntry, loadDeclarative } from '../../src/enzyme/declarative.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-decl-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function entry(yaml: string): void {
  writeFileSync(join(dir, 'enzyme.yaml'), yaml, 'utf8')
}

function invocation(command: string): Invocation {
  return {
    command,
    args: {},
    rest: '',
    message: {
      channel: 'test', conversationId: 'c:1', messageId: 'm:1',
      sender: { channel: 'test', externalId: 'x' },
      text: '', attachments: [], raw: null, receivedAt: new Date(0),
    },
  }
}

it('detects the entry point', () => {
  expect(hasDeclarativeEntry(dir)).toBe(false)
  entry('responses:\n  ping: pong\n')
  expect(hasDeclarativeEntry(dir)).toBe(true)
})

it('answers a declared command', async () => {
  entry('responses:\n  ping: pong\n')
  const instance = loadDeclarative(dir, ['ping']).create()
  let said: string | undefined
  await instance.handle(invocation('ping'), {
    reply: async (c: { text: string }) => { said = c.text },
  } as unknown as EnzymeContext)
  expect(said).toBe('pong')
})

it('refuses a response for a command the manifest does not declare', () => {
  entry('responses:\n  ping: pong\n  ghost: boo\n')
  expect(() => loadDeclarative(dir, ['ping'])).toThrow('undeclared')
})

it('refuses a declared command with no response', () => {
  entry('responses:\n  ping: pong\n')
  expect(() => loadDeclarative(dir, ['ping', 'pong'])).toThrow('no response for')
})
