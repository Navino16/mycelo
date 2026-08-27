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

  // Whichever @ a split uses, one side keeps an embedded @ — the name charset and the strain
  // shape both forbid @, so a tag carrying two of them is rejected either way.
  test('rejects a tag carrying a second @ before the strain', () => {
    expect(parseTag('foo@bar@1.0.0')).toBeNull()
  })

  test('rejects a tag carrying a second @ after the strain', () => {
    expect(parseTag('foo@1.0.0@bar')).toBeNull()
  })
})

describe('parseTag name charset', () => {
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

  // Matches septum's own manifest nameSchema exactly, so parseTag never accepts an offer name
  // parseManifest would later reject.
  test('rejects a name starting with a digit', () => {
    expect(parseTag('9lives@1.0.0')).toBeNull()
  })

  test('rejects a name starting with an uppercase letter', () => {
    expect(parseTag('Radarr@1.0.0')).toBeNull()
  })
})

describe('parseTag strain shape', () => {
  test('accepts a prerelease and a build strain', () => {
    expect(parseTag('radarr@1.0.0-beta.1')).toEqual({ name: 'radarr', strain: '1.0.0-beta.1' })
    expect(parseTag('radarr@1.0.0+build.5')).toEqual({ name: 'radarr', strain: '1.0.0+build.5' })
  })

  // Bun.semver.satisfies tolerates trailing garbage after a parseable version prefix, so the
  // shape must be checked separately — these all currently satisfy `=<v>` unless rejected here.
  test('rejects a strain carrying a path traversal', () => {
    expect(parseTag('radarr@1.0.0/../../etc')).toBeNull()
  })

  test('rejects a strain carrying a shell metacharacter', () => {
    expect(parseTag('radarr@1.0.0;rm -rf /')).toBeNull()
  })

  test('rejects a strain carrying a trailing newline', () => {
    expect(parseTag('radarr@1.0.0\n')).toBeNull()
  })

  test('rejects a strain carrying trailing dots', () => {
    expect(parseTag('radarr@1.0.0..')).toBeNull()
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

describe('githubDriver tag pagination', () => {
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
    // Bounded, not truly infinite: the fake itself stops offering a next link past 50 calls,
    // so dropping the cap check yields a clean assertion failure instead of a hang.
    const bounded = (() => {
      calls += 1
      const headers = calls <= 50
        ? { link: '<https://api.github.com/repos/o/r/tags?per_page=100&page=x>; rel="next"' }
        : {}
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers }))
    }) as unknown as typeof fetch
    const driver = githubDriver('https://github.com/o/r', null, bounded)
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

  // A failure past page 1 must name the page that actually failed, not a fixed literal.
  test('a failing page names the page url that failed', async () => {
    const paged = ((input: string | URL | Request) => {
      const url = urlOf(input)
      if (url.includes('page=2')) return Promise.resolve(new Response('nope', { status: 500 }))
      return Promise.resolve(new Response(JSON.stringify([{ name: 'radarr@0.1.0' }]), {
        status: 200,
        headers: { link: '<https://api.github.com/repos/o/r/tags?per_page=100&page=2>; rel="next"' },
      }))
    }) as typeof fetch
    const driver = githubDriver('https://github.com/o/r', null, paged)
    expect(driver.list()).rejects.toThrow(/page=2/)
  })
})

describe('githubDriver authorization header', () => {
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

  // A CDN failure must reject, not hand the error body to inoculate as the tarball.
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

describe('githubDriver location refusal', () => {
  test('constructing the driver never throws synchronously on a junk location', () => {
    expect(() => githubDriver('not a url', null, fakeFetch({}))).not.toThrow()
  })

  test('a junk location rejects the operation the caller awaits, naming the location', () => {
    const driver = githubDriver('not a url', null, fakeFetch({ '/tags': TAGS }))
    expect(driver.list()).rejects.toThrow(/not a GitHub repository URL/)
  })
})

describe('githubDriver location host and scheme', () => {
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

  test('a refusal for a credentialed non-GitHub location does not echo the credential', () => {
    const driver = githubDriver('https://x-access-token:secret-pat@gitlab.com/o/r', null, fakeFetch({}))
    expect(driver.list()).rejects.toThrow(/^(?!.*secret-pat).*not a GitHub repository URL/)
  })

  // Unparseable (a stray space, an out-of-range port) still must not echo the credential —
  // the redaction happens before new URL() is even attempted to succeed.
  test('a refusal for an unparseable credentialed location does not echo the credential', () => {
    const driver = githubDriver('https://x-access-token:secret-pat@not a valid url', null, fakeFetch({}))
    expect(driver.list()).rejects.toThrow(/^(?!.*secret-pat).*not a GitHub repository URL/)
  })
})

describe('githubDriver location forms an operator pastes', () => {
  test('accepts a .git-suffixed location', async () => {
    const driver = githubDriver('https://github.com/o/r.git', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })

  test('accepts a location carrying extra path segments', async () => {
    const driver = githubDriver('https://github.com/o/r/tree/main', null, fakeFetch({ '/tags': TAGS }))
    expect((await driver.list()).length).toBeGreaterThan(0)
  })
})
