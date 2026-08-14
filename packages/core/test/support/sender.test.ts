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

  it('reads a group marker after the sender', () => {
    expect(parseSenderLine('alice@weekend> /whoami')).toEqual({
      sender: 'alice', group: 'weekend', text: '/whoami',
    })
  })

  it('leaves a line with no marker as a direct message', () => {
    expect(parseSenderLine('alice> /whoami')).toEqual({ sender: 'alice', text: '/whoami' })
  })

  it('treats an empty group name as no group', () => {
    expect(parseSenderLine('alice@> /whoami')).toEqual({ sender: 'alice', text: '/whoami' })
  })

  it('splits on the first @ of the sender part only, leaving the text untouched', () => {
    // A mail-shaped word in the text must not become a group.
    expect(parseSenderLine('alice@weekend> write to bob@example.com')).toEqual({
      sender: 'alice', group: 'weekend', text: 'write to bob@example.com',
    })
  })

  it('keeps falling back to local for a marker with no sender', () => {
    expect(parseSenderLine('@weekend> /whoami')).toEqual({ sender: 'local', group: 'weekend', text: '/whoami' })
  })
})
