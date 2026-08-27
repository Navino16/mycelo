import { parse as parseYaml } from 'yaml'
import { parseManifest } from '@mycelo/septum'
import type { SporangiumDriver, SporeBundle, SporeDetail, SporeOffer } from './driver.js'

// GitHub does not cap `per_page`, so a hard page cap is what turns an unbounded sporangium
// into a refusal instead of a silently truncated list (fix round 1, Important 6).
const MAX_TAG_PAGES = 10

// septum's manifest nameSchema (packages/septum/src/manifest.ts) is not exported (ruling 9
// checked). Mirrored here because a released bundle's SporeOffer.name becomes a directory name
// under the managed root, and a third-party sporangium is not code-reviewed (fix round 1,
// Important 2).
const SPORE_NAME = /^[a-z0-9][a-z0-9-]*$/

/** `<name>@<semver>`: the tag format half A cut, and the only one this driver reads. */
export function parseTag(tag: string): { name: string, strain: string } | null {
  const at = tag.lastIndexOf('@')
  if (at <= 0) return null
  const name = tag.slice(0, at)
  const strain = tag.slice(at + 1)
  if (!SPORE_NAME.test(name)) return null
  // `=<v>` is satisfied only by that exact version, so it doubles as a version validator.
  if (!Bun.semver.satisfies(strain, `=${strain}`)) return null
  return { name, strain }
}

// host+pathname only: `location` may carry embedded credentials (`https://user:pat@github.com/o/r`)
// and this string reaches an operator-facing refusal (fix round 1, minor 1).
function safeLocation(url: URL): string {
  return `${url.host}${url.pathname}`
}

function repoOf(location: string): { owner: string, repo: string } {
  let url: URL
  try {
    url = new URL(location)
  } catch {
    throw new Error(`'${location}' is not a GitHub repository URL`)
  }
  if (url.protocol !== 'https:' || (url.host !== 'github.com' && url.host !== 'www.github.com')) {
    throw new Error(`'${safeLocation(url)}' is not a GitHub repository URL`)
  }
  const [owner, repo] = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
  if (owner === undefined || owner === '' || repo === undefined || repo === '') {
    throw new Error(`'${safeLocation(url)}' is not a GitHub repository URL`)
  }
  return { owner, repo }
}

function nextPageUrl(response: Response): string | null {
  const link = response.headers.get('link')
  if (link === null) return null
  const next = link.split(',').find((part) => /rel="next"/.test(part))
  const match = next === undefined ? null : /<([^>]+)>/.exec(next)
  return match?.[1] ?? null
}

export function githubDriver(
  location: string,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): SporangiumDriver {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
  // Optional, and what raises the listing budget from 60 requests an hour to 5000 (design §8).
  if (token !== null) headers.authorization = `Bearer ${token}`

  // repoOf(location) is resolved lazily, inside an async function, not at construction: a junk
  // location must reject the call the caller awaits, not throw out of the factory (design §6/§9).
  function baseUrl(): string {
    const { owner, repo } = repoOf(location)
    return `https://api.github.com/repos/${owner}/${repo}`
  }

  async function fetchOk(url: string, label: string): Promise<Response> {
    const response = await fetchImpl(url, { headers })
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} for ${label}`)
    return response
  }

  async function get<T>(path: string): Promise<T> {
    const response = await fetchOk(`${baseUrl()}${path}`, path)
    return await response.json() as T
  }

  async function tags(): Promise<readonly { name: string, strain: string }[]> {
    const collected: { name: string }[] = []
    let url: string | null = `${baseUrl()}/tags?per_page=100`
    for (let page = 0; url !== null; page += 1) {
      if (page >= MAX_TAG_PAGES) {
        throw new Error(`sporangium tag list exceeds ${MAX_TAG_PAGES} pages; refusing to keep paginating`)
      }
      const response = await fetchOk(url, '/tags?per_page=100')
      collected.push(...await response.json() as readonly { name: string }[])
      url = nextPageUrl(response)
    }
    return collected.map((t) => parseTag(t.name))
      .filter((t): t is { name: string, strain: string } => t !== null)
  }

  return {
    list: async () => {
      const newest = new Map<string, string>()
      for (const { name, strain } of await tags()) {
        const held = newest.get(name)
        if (held === undefined || Bun.semver.order(strain, held) > 0) newest.set(name, strain)
      }
      return [...newest].map(([name, strain]): SporeOffer => ({ name, strain }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    strains: async (name) => (await tags())
      .filter((t) => t.name === name)
      .map((t) => t.strain)
      .sort((a, b) => Bun.semver.order(b, a)),

    detail: async (name, strain) => {
      const file = await get<{ content: string }>(
        `/contents/spores/${name}/spore.yaml?ref=${encodeURIComponent(`${name}@${strain}`)}`,
      )
      const manifest = parseManifest(parseYaml(Buffer.from(file.content, 'base64').toString('utf8')))
      return {
        name: manifest.name,
        kind: manifest.kind,
        description: manifest.description ?? '',
        septum: manifest.septum,
      } satisfies SporeDetail
    },

    fetch: async (name, strain) => {
      const tag = `${name}@${strain}`
      const release = await get<{ assets: readonly { name: string, browser_download_url: string }[] }>(
        `/releases/tags/${encodeURIComponent(tag)}`,
      )
      const wanted = `${name}-${strain}.tgz`
      const asset = release.assets.find((a) => a.name === wanted)
      if (asset === undefined) throw new Error(`release '${tag}' carries no asset named '${wanted}'`)
      const response = await fetchImpl(asset.browser_download_url, { headers })
      if (!response.ok) throw new Error(`downloading '${wanted}' answered ${String(response.status)}`)
      return { tarball: new Uint8Array(await response.arrayBuffer()), strain } satisfies SporeBundle
    },
  }
}
