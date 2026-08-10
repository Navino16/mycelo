import { expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

it('builds and exports', () => {
  expect(VERSION).toBe('0.0.0')
})
