import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { CatalogError, loadCatalogs } from '../../src/i18n/catalog.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mycelo-catalog-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function write(name: string, body: string): void {
  writeFileSync(join(dir, name), body, 'utf8')
}

describe('loadCatalogs', () => {
  it('resolves an empty map for a directory that does not exist', () => {
    expect(loadCatalogs(join(dir, 'absent')).size).toBe(0)
  })

  it('reads one locale per file, keyed by the canonical tag', () => {
    write('en.yaml', 'greeting: hello\n')
    write('fr.yaml', 'greeting: bonjour\n')
    // Plural, not a single locale: a loader that returned only the last file read would
    // pass a one-file test.
    const loaded = loadCatalogs(dir)
    expect([...loaded.keys()].sort()).toEqual(['en', 'fr'])
    expect(loaded.get('en')?.get('greeting')?.format()).toBe('hello')
    expect(loaded.get('fr')?.get('greeting')?.format()).toBe('bonjour')
  })

  it('canonicalises the tag in the filename', () => {
    write('fr-fr.yaml', 'greeting: bonjour\n')
    expect([...loadCatalogs(dir).keys()]).toEqual(['fr-FR'])
  })

  it('flattens nested maps into dotted keys, keeping every branch', () => {
    write('en.yaml', 'error:\n  timeout: timed out\n  refused: refused\nready: ready\n')
    const messages = loadCatalogs(dir).get('en')
    expect([...(messages?.keys() ?? [])].sort()).toEqual(['error.refused', 'error.timeout', 'ready'])
  })

  it('accepts a literal dotted key, indistinguishable from a nested one', () => {
    write('en.yaml', '"error.timeout": timed out\n')
    expect(loadCatalogs(dir).get('en')?.get('error.timeout')?.format()).toBe('timed out')
  })

  it('compiles ICU, so a parameter is substituted at format time', () => {
    write('en.yaml', 'found: "found {title}"\n')
    expect(loadCatalogs(dir).get('en')?.get('found')?.format({ title: 'Dune' })).toBe('found Dune')
  })

  it('throws a CatalogError naming the file and the key for an ICU message that will not compile', () => {
    write('es.yaml', 'broken: "type {help"\n')
    let thrown: unknown
    try { loadCatalogs(dir) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(CatalogError)
    expect((thrown as CatalogError).file).toBe(join(dir, 'es.yaml'))
    expect((thrown as CatalogError).key).toBe('broken')
    expect((thrown as Error).message).toContain('broken')
  })

  it('throws a CatalogError naming the file for YAML that will not parse', () => {
    write('en.yaml', 'a:\n  - [unclosed\n')
    let thrown: unknown
    try { loadCatalogs(dir) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(CatalogError)
    expect((thrown as CatalogError).key).toBeNull()
  })

  it('throws for a leaf that is neither a string nor a map', () => {
    write('en.yaml', 'count: 3\n')
    expect(() => loadCatalogs(dir)).toThrow(/count/)
  })

  it('throws for a filename that is not a locale tag', () => {
    write('not a locale.yaml', 'greeting: hello\n')
    expect(() => loadCatalogs(dir)).toThrow(/not a locale/)
  })

  it('ignores a file that is not a .yaml, and a subdirectory', () => {
    write('en.yaml', 'greeting: hello\n')
    write('README.md', '# not a catalogue\n')
    mkdirSync(join(dir, 'nested'))
    expect([...loadCatalogs(dir).keys()]).toEqual(['en'])
  })
})
