import { describe, expect, it } from 'bun:test'
import { parseSenderLine } from '../../src/support/sender.js'

describe('parseSenderLine', () => {
  it('speaks as local when the line has no prefix at all', () => {
    expect(parseSenderLine('/movies Dune')).toEqual({ sender: 'local', text: '/movies Dune' })
  })

  it('takes the name before the first > as the sender', () => {
    expect(parseSenderLine('alice> /movies Dune')).toEqual({ sender: 'alice', text: '/movies Dune' })
  })

  it('falls back to local when the name is blank', () => {
    expect(parseSenderLine('> hi')).toEqual({ sender: 'local', text: 'hi' })
  })

  it('splits on the first > only, leaving a later > inside the text', () => {
    expect(parseSenderLine('alice> /echo a > b')).toEqual({ sender: 'alice', text: '/echo a > b' })
  })

  it('returns empty text for a line that is only a bare >', () => {
    // The caller (index.ts) checks text !== '' before feeding, so this never reaches feed().
    expect(parseSenderLine('>')).toEqual({ sender: 'local', text: '' })
  })

  it('trims whitespace around the name and around the text', () => {
    expect(parseSenderLine('  alice  >   /movies Dune  ')).toEqual({ sender: 'alice', text: '/movies Dune' })
  })
})
