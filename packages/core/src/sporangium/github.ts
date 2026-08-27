import { parse as parseYaml } from 'yaml'
import { parseManifest } from '@mycelo/septum'
import type { SporangiumDriver, SporeBundle, SporeDetail, SporeOffer } from './driver.js'

/** `<name>@<semver>`: the tag format half A cut, and the only one this driver reads. */
export function parseTag(tag: string): { name: string, strain: string } | null {
  const at = tag.lastIndexOf('@')
  if (at <= 0) return null
  const name = tag.slice(0, at)
  const strain = tag.slice(at + 1)
  // `=<v>` is satisfied only by that exact version, so it doubles as a version validator.
  if (!Bun.semver.satisfies(strain, `=${strain}`)) return null
  return { name, strain }
}

function repoOf(location: string): { owner: string, repo: string } {
  let pathname: string
  try {
    pathname = new URL(location).pathname
  } catch {
    throw new Error(`'${location}' is not a GitHub repository URL`)
  }
  const [owner, repo] = pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
  if (owner === undefined || owner === '' || repo === undefined || repo === '') {
    throw new Error(`'${location}' is not a GitHub repository URL`)
  }
  return { owner, repo }
}

export function githubDriver(
  location: string,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): SporangiumDriver {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
  // Optional, and what raises the listing budget from 60 requests an hour to 5000 (§8).
  if (token !== null) headers.authorization = `Bearer ${token}`

  // repoOf(location) is called here, inside an async function, rather than once at
  // construction — a junk location must reject the call the caller awaits, not throw
  // out of the factory (ruling 8).
  async function get<T>(path: string): Promise<T> {
    const { owner, repo } = repoOf(location)
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers })
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)} for ${path}`)
    return await response.json() as T
  }

  async function tags(): Promise<readonly { name: string, strain: string }[]> {
    const raw = await get<readonly { name: string }[]>('/tags?per_page=100')
    return raw.map((t) => parseTag(t.name))
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
