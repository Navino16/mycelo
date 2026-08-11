import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { erasabilityError } from '@mycelo/septum/conformance'

it('is loadable by the local driver', () => {
  const source = readFileSync(new URL('../../../../fixtures/helpdesk/src/index.ts', import.meta.url), 'utf8')
  expect(erasabilityError(source)).toBeNull()
})
