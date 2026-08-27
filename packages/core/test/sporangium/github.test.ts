import { describe, expect, test } from 'bun:test'
import { githubDriver, parseTag } from '../../src/sporangium/github.js'

const TAGS = [
  { name: 'radarr@0.1.0' },
  { name: 'radarr@0.2.0' },
  { name: 'help@0.2.0' },
  { name: 'radarr@0.10.0' },
  { name: 'v1.2.3' },
  { name: 'not-a-tag' },
]

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (key === undefined) return Promise.resolve(new Response('nope', { status: 404 }))
    const body = routes[key]
    if (body instanceof Uint8Array) return Promise.resolve(new Response(body, { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  }) as typeof fetch
}

describe('parseTag', () => {
  test('reads the name and the strain out of a spore tag', () => {
    expect(parseTag('radarr@0.2.0')).toEqual({ name: 'radarr', strain: '0.2.0' })
    expect(parseTag('upcoming-movies@1.0.0')).toEqual({ name: 'upcoming-movies', strain: '1.0.0' })
  })

  test('rejects a tag that is not a spore release', () => {
    expect(parseTag('v1.2.3')).toBeNull()
    expect(parseTag('not-a-tag')).toBeNull()
    expect(parseTag('radarr@notsemver')).toBeNull()
    expect(parseTag('@0.1.0')).toBeNull()
  })
})

describe('githubDriver.list', () => {
  test('answers one offer per spore with its newest strain, from one request', async () => {
    let calls = 0
    const counting = ((input: string | URL | Request) => {
      calls += 1
      return fakeFetch({ '/tags': TAGS })(input)
    }) as typeof fetch
    const offers = await githubDriver('https://github.com/o/r', null, counting).list()
    expect(calls).toBe(1)
    // 0.10.0 beats 0.2.0: the sort must be semver, not lexicographic (design §8).
    expect(offers).toEqual([
      { name: 'help', strain: '0.2.0' },
      { name: 'radarr', strain: '0.10.0' },
    ])
  })

  test('strains are newest first, and only for the name asked for', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({ '/tags': TAGS }))
    expect(await driver.strains('radarr')).toEqual(['0.10.0', '0.2.0', '0.1.0'])
    expect(await driver.strains('help')).toEqual(['0.2.0'])
    expect(await driver.strains('absent')).toEqual([])
  })

  test('a failing request rejects rather than answering an empty list', async () => {
    // An empty answer that doubles as "this source offers nothing" is a false report.
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({}))
    expect(driver.list()).rejects.toThrow(/404/)
  })
})

describe('githubDriver.detail', () => {
  test('reads kind, description and the declared range from spore.yaml at the tag', async () => {
    const yaml = ['name: radarr', 'kind: rhiza', 'septum: "^0.10"', 'description: Radarr connector'].join('\n')
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({
      '/contents/': { content: Buffer.from(yaml, 'utf8').toString('base64') },
    }))
    expect(await driver.detail('radarr', '0.2.0')).toEqual({
      name: 'radarr',
      kind: 'rhiza',
      description: 'Radarr connector',
      septum: '^0.10',
    })
  })
})

describe('githubDriver.fetch', () => {
  test('downloads the asset named for the spore and the strain', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({
      '/releases/tags/': { assets: [
        { name: 'other-0.2.0.tgz', browser_download_url: 'https://dl/other' },
        { name: 'radarr-0.2.0.tgz', browser_download_url: 'https://dl/radarr' },
      ] },
      'https://dl/radarr': bytes,
    }))
    const bundle = await driver.fetch('radarr', '0.2.0')
    expect(bundle.strain).toBe('0.2.0')
    expect([...bundle.tarball]).toEqual([1, 2, 3])
  })

  test('refuses a release whose asset is missing, naming what it looked for', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({
      '/releases/tags/': { assets: [{ name: 'wrong.tgz', browser_download_url: 'https://dl/x' }] },
    }))
    expect(driver.fetch('radarr', '0.2.0')).rejects.toThrow(/radarr-0\.2\.0\.tgz/)
  })
})

describe('githubDriver location refusal (ruling 8)', () => {
  test('constructing the driver never throws synchronously on a junk location', () => {
    expect(() => githubDriver('not a url', null, fakeFetch({}))).not.toThrow()
  })

  test('a junk location rejects the operation the caller awaits, naming the location', () => {
    const driver = githubDriver('not a url', null, fakeFetch({ '/tags': TAGS }))
    expect(driver.list()).rejects.toThrow(/not a GitHub repository URL/)
  })
})
