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

const RELEASED_SPORE_NAMES = [
  'signal', 'admin', 'help', 'links', 'group-gate',
  'now-watching', 'upcoming-movies', 'plex', 'radarr',
]

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = urlOf(input)
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

  // A second @ puts an @ in either the name (splitting on the last, correct) or the strain
  // (splitting on the first) — both are rejected by the charset/semver checks below, so this
  // also pins the split point stays "last" rather than "first" (fix round 1, Important 1).
  test('rejects a tag carrying a second @, whichever @ a split would use', () => {
    expect(parseTag('foo@bar@1.0.0')).toBeNull()
  })
})

describe('parseTag name charset (fix round 1, Important 2)', () => {
  test('accepts a hyphenated manifest name', () => {
    expect(parseTag('group-gate@0.2.0')).toEqual({ name: 'group-gate', strain: '0.2.0' })
  })

  test('accepts every one of the nine released spore names', () => {
    for (const name of RELEASED_SPORE_NAMES) {
      expect(parseTag(`${name}@0.2.0`)).toEqual({ name, strain: '0.2.0' })
    }
  })

  test('rejects a name carrying a path separator', () => {
    expect(parseTag('a/b@1.0.0')).toBeNull()
  })

  test('rejects a name attempting path traversal', () => {
    expect(parseTag('../../x@1.0.0')).toBeNull()
  })
})

describe('githubDriver.list', () => {
  test('answers one offer per spore with its newest strain, from one request', async () => {
    let calls = 0
    let requestedUrl = ''
    const counting = ((input: string | URL | Request) => {
      calls += 1
      requestedUrl = urlOf(input)
      return fakeFetch({ '/tags': TAGS })(input)
    }) as typeof fetch
    const offers = await githubDriver('https://github.com/o/r', null, counting).list()
    expect(calls).toBe(1)
    expect(requestedUrl).toContain('per_page=100')
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

describe('githubDriver tag pagination (fix round 1, Important 6)', () => {
  test('follows Link: rel="next" and returns the union of pages', async () => {
    const page1 = [{ name: 'radarr@0.1.0' }]
    const page2 = [{ name: 'radarr@0.2.0' }]
    let calls = 0
    const paged = ((input: string | URL | Request) => {
      calls += 1
      const url = urlOf(input)
      if (url.includes('page=2')) return Promise.resolve(new Response(JSON.stringify(page2), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(page1), {
        status: 200,
        headers: { link: '<https://api.github.com/repos/o/r/tags?per_page=100&page=2>; rel="next"' },
      }))
    }) as typeof fetch
    const driver = githubDriver('https://github.com/o/r', null, paged)
    expect(await driver.strains('radarr')).toEqual(['0.2.0', '0.1.0'])
    expect(calls).toBe(2)
  })

  test('a Link chain beyond the page cap throws naming the cap, rather than truncating', async () => {
    let calls = 0
    const infinite = (() => {
      calls += 1
      return Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { link: '<https://api.github.com/repos/o/r/tags?per_page=100&page=x>; rel="next"' },
      }))
    }) as unknown as typeof fetch
    const driver = githubDriver('https://github.com/o/r', null, infinite)
    let caught: unknown
    try {
      await driver.list()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/10/)
    expect(calls).toBe(10)
  })
})

describe('githubDriver token (fix round 1, Important 3)', () => {
  test('the authorization header carries the token when one is set', async () => {
    let authorization: string | undefined
    const capturing = ((input: string | URL | Request, init?: RequestInit) => {
      authorization = (init?.headers as Record<string, string> | undefined)?.authorization
      return fakeFetch({ '/tags': TAGS })(input)
    }) as typeof fetch
    await githubDriver('https://github.com/o/r', 'secret-token', capturing).list()
    expect(authorization).toBe('Bearer secret-token')
  })

  test('no authorization header is sent when the token is null', async () => {
    let authorization: string | undefined = 'unset'
    const capturing = ((input: string | URL | Request, init?: RequestInit) => {
      authorization = (init?.headers as Record<string, string> | undefined)?.authorization
      return fakeFetch({ '/tags': TAGS })(input)
    }) as typeof fetch
    await githubDriver('https://github.com/o/r', null, capturing).list()
    expect(authorization).toBeUndefined()
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

  test('a missing spore.yaml rejects', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({}))
    expect(driver.detail('radarr', '0.2.0')).rejects.toThrow(/404/)
  })

  test('unparseable YAML in spore.yaml rejects', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({
      '/contents/': { content: Buffer.from('not: [valid', 'utf8').toString('base64') },
    }))
    expect(driver.detail('radarr', '0.2.0')).rejects.toThrow()
  })

  test('a spore.yaml that fails manifest validation rejects', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({
      '/contents/': { content: Buffer.from('name: radarr', 'utf8').toString('base64') },
    }))
    expect(driver.detail('radarr', '0.2.0')).rejects.toThrow()
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

  // A CDN failure must reject, not hand the error body to inoculate as the tarball
  // (fix round 1, Important 5).
  test('a failing asset download rejects rather than returning the error body as a tarball', async () => {
    const failing = ((input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.includes('/releases/tags/')) {
        return Promise.resolve(new Response(JSON.stringify({
          assets: [{ name: 'radarr-0.2.0.tgz', browser_download_url: 'https://dl/radarr' }],
        }), { status: 200 }))
      }
      if (url === 'https://dl/radarr') return Promise.resolve(new Response('service unavailable', { status: 503 }))
      return Promise.resolve(new Response('nope', { status: 404 }))
    }) as typeof fetch
    const driver = githubDriver('https://github.com/o/r', null, failing)
    expect(driver.fetch('radarr', '0.2.0')).rejects.toThrow(/503/)
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

describe('githubDriver location host and scheme (fix round 1, Important 4)', () => {
  test('accepts an https github.com location', async () => {
    const driver = githubDriver('https://github.com/o/r', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })

  test('accepts an https www.github.com location', async () => {
    const driver = githubDriver('https://www.github.com/o/r', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })

  test('refuses a non-GitHub host', () => {
    const driver = githubDriver('https://gitlab.com/o/r', null, fakeFetch({ '/tags': TAGS }))
    expect(driver.list()).rejects.toThrow(/not a GitHub repository URL/)
  })

  test('refuses a non-https scheme', () => {
    const driver = githubDriver('file:///etc/passwd/x', null, fakeFetch({ '/tags': TAGS }))
    expect(driver.list()).rejects.toThrow(/not a GitHub repository URL/)
  })

  // A credential embedded in the location (a standard GitHub form) must not reach the refusal
  // message (fix round 1, minor 1).
  test('a refusal for a credentialed non-GitHub location does not echo the credential', () => {
    const driver = githubDriver('https://x-access-token:secret-pat@gitlab.com/o/r', null, fakeFetch({}))
    expect(driver.list()).rejects.toThrow(/^(?!.*secret-pat).*not a GitHub repository URL/)
  })
})

describe('githubDriver location forms an operator pastes (fix round 1, minor 4)', () => {
  test('accepts a .git-suffixed location', async () => {
    const driver = githubDriver('https://github.com/o/r.git', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })

  test('accepts a location carrying extra path segments', async () => {
    const driver = githubDriver('https://github.com/o/r/tree/main', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })
})
