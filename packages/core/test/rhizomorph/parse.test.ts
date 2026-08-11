import { expect, it } from 'bun:test'
import { bindArgs, parseCommand } from '../../src/rhizomorph/parse.js'

it('parses a bare command', () => {
  expect(parseCommand('/ping', '/')).toEqual({ command: 'ping', args: {}, rest: '' })
})

it('separates the command from the rest', () => {
  expect(parseCommand('/add a movie title', '/')?.rest).toBe('a movie title')
})

it('ignores text without the prefix', () => {
  expect(parseCommand('ping', '/')).toBeNull()
})

it('honours a non-slash prefix', () => {
  expect(parseCommand('!ping', '!')?.command).toBe('ping')
})

it('rejects a command name the manifest schema would reject', () => {
  expect(parseCommand('/Ping', '/')).toBeNull()
  expect(parseCommand('/1ping', '/')).toBeNull()
})

it('binds positional arguments, the last absorbing the remainder', () => {
  const specs = [
    { name: 'quality', description: 'q', required: true },
    { name: 'title', description: 't', required: true },
  ]
  expect(bindArgs('1080p The Big Lebowski', specs)).toEqual({
    quality: '1080p',
    title: 'The Big Lebowski',
  })
})

it('binds a single argument absorbing the whole remainder', () => {
  const specs = [{ name: 'query', description: 'q', required: true }]
  expect(bindArgs('the big lebowski', specs)).toEqual({ query: 'the big lebowski' })
})

it('binds nothing when the command declares no arguments', () => {
  expect(bindArgs('whatever', [])).toEqual({})
})
