# @mycelo/septum

The plugin contract for [Mycelo](https://github.com/Navino16/mycelo) — a self-hosted,
multi-channel chat bot assembled entirely from plugins.

A `septum` is the interface a plugin implements. There are four, one per plugin kind:

| Kind | Implements | Does |
|---|---|---|
| `hypha` | `Hypha` | A channel — reaches out and touches the outside world (Signal, Discord) |
| `rhiza` | `Rhiza` | A connected system — two-way exchange with a foreign service (Radarr, Plex) |
| `enzyme` | `Enzyme` | A command — turns an input into a response |
| `inhibitor` | `Inhibitor` | A filter — decides whether a sender may be heard at all |

## Install

```sh
npm install @mycelo/septum
```

ESM only — `require()` will not work. `zod` is a direct dependency, used to validate manifests.

## A plugin is two files

### `spore.yaml`

The manifest. The core reads it before any plugin code runs, which is why commands and
capabilities are declared here rather than in the module.

```yaml
kind: enzyme
name: radarr-helper
septum: "^0.4"
description: Movie shortcuts for Radarr
commands:
  - name: help
    description: Show what this plugin can do
    respond: "Try /add <title> to queue a movie."
  - name: add
    description: Queue a movie by title
    code: addMovie
    args:
      - name: title
        description: Movie title
        required: true
```

A command carries exactly one of `respond` or `code`, never both and never neither:
`respond` is a fixed string sent back untouched, `code` names a handler the module
exports. `args` only makes sense on a `code` command — `respond` has no way to
interpolate one, so declaring it there is rejected.

Every manifest carries `kind`, `name` (lowercase, digits and dashes) and `septum`, the
contract range it targets. `description`, `externals` and `requires` are optional everywhere.
Each kind then adds its own:

| Kind | Adds |
|---|---|
| `hypha` | `capabilities`: any of `attachments`, `reactions`, `threads`, `group_membership` |
| `rhiza` | — |
| `enzyme` | `commands`: at least one, each with a `name`, a `description`, and exactly one of `respond` (a fixed text reply) or `code` (a handler name); `code` commands may add `args` |
| `inhibitor` | `enforcing`: whether a denial actually blocks, default `false` |

A `requires` entry names one rhiza, with optional `scopes` and `optional: true`. A missing
mandatory dependency leaves the spore dormant, naming the target; an absent optional one does
not, and `ctx.has()` answers `false` for it. Use `any_of` instead when two rhizas would both do —
it collapses to the first alternative that is actually installed, and only that one becomes an
edge in the dependency graph:

```yaml
requires:
  - any_of:
      - rhiza: radarr
      - rhiza: sonarr
```

If neither `radarr` nor `sonarr` is installed, the spore is dormant naming both alternatives.

Cycle detection runs over every `requires` edge in the graph, **optional included, with no
exemption** — anywhere in the graph, not only between two spores that require each other
directly. This means two plugins that only *optionally* require each other still cannot
coexist: the bot refuses to start at all, naming every plugin in the cycle.

`parseManifest` validates the parsed YAML and throws a `ManifestError` naming the offending
field.

### `requires: [{ rhiza: mycelium, scopes: [...] }]`

`mycelium` is the core itself, reachable like any other rhiza but never declared as installed —
every spore may require it. `scopes` is mandatory-per-method: each granted scope mounts one method
on the object `ctx.rhiza('mycelium')` returns, and an ungranted scope's method is simply absent,
not present-but-rejecting:

| Scope | Mounts |
|---|---|
| `plugins.read` | `listPlugins(): readonly PluginInfo[]` |
| `health.read` | `health(): Promise<readonly RhizaHealth[]>` |
| `messages.send` | `send(target: PushTarget, content: OutgoingContent): Promise<void>` |

The remaining `MyceliumScope` values (`principals.*`, `roles.*`, `plugins.toggle`) parse but leave
the spore dormant, naming the phase that mounts them — none does yet.

```yaml
requires:
  - rhiza: mycelium
    scopes: [plugins.read]
```

```ts
async start(ctx) {
  const plugins = ctx.rhiza<{ listPlugins(): { name: string }[] }>('mycelium').listPlugins()
}
```

`scopes` may only be set on the `mycelium` requirement; setting it on any other rhiza is rejected,
since only the mycelium has a scope model.

### `src/index.ts`

The module. One default export, one `create()` per germination. `handlers` is keyed by
the names the manifest's `code:` fields reference — here, `addMovie`.

```ts
import type { EnzymeModule } from '@mycelo/septum'

export default {
  create: () => ({
    handlers: {
      async addMovie(invocation, ctx) {
        const title = invocation.args['title']
        await ctx.reply({ text: `queued ${title ?? 'nothing'}` })
      },
    },
  }),
} satisfies EnzymeModule
```

Add a `configSchema` when the plugin takes configuration. It is duck-typed rather than typed
as a Zod schema: a plugin is bundled with its own copy of Zod, so its schemas are not
instances of the core's. Anything with a compatible `safeParse` is accepted.

A plugin whose commands all carry `respond:` needs no module at all — `help` above answers
without one. The manifest is then the entire plugin: no `src/index.ts`, nothing to bundle,
nothing that can throw at germination.

## TypeScript

The runtime is [Bun](https://bun.sh), which compiles TypeScript directly. A plugin may use any
TypeScript construct — `enum`, `namespace`, decorators, parameter properties — and needs no
bundler and no build step. It may be split across several files that import each other with
`.js` specifiers, resolved the way Node's ESM does.

## Conformance kit

`@mycelo/septum/conformance` exports checks a plugin author runs against their own
implementation. Each returns a list of failure strings, so it works with any test runner:

| Export | Checks |
|---|---|
| `hyphaChecks` | manifest, config schema, `connect`/`listen`/`stop`/`send`, `group_membership` consistency |
| `rhizaChecks` | manifest, config schema, `api`, and that `health()` reports rather than throws |
| `enzymeChecks` | manifest, config schema, lifecycle, and every command with no required args |
| `inhibitorChecks` | manifest, config schema, lifecycle, and a verdict per expected allow/deny |

The harness is yours to build: the kit cannot know what your plugin depends on, so you supply
the stubs.

```ts
import type { EnzymeContext } from '@mycelo/septum'
import { enzymeChecks } from '@mycelo/septum/conformance'
import { expect, it } from 'bun:test'
import module from '../src/index.js'

const context = (): EnzymeContext => ({
  config: {},
  logger: { debug() {}, info() {}, warn() {}, error() {}, child: () => context().logger },
  async reply() {},
  async push() {},
  rhiza: <T,>() => ({}) as T,
  has: () => false,
  capabilities: { has: () => true, list: () => [] },
  capabilitiesOf: () => ({ has: () => true, list: () => [] }),
  principal: { id: 'p1', identities: [], roles: [] },
  on() {},
})

it('conforms to the Enzyme contract', async () => {
  const failures = await enzymeChecks({
    name: 'radarr-helper',
    manifest: {
      kind: 'enzyme', name: 'radarr-helper', septum: '^0.4',
      commands: [
        { name: 'help', description: 'Show what this plugin can do', respond: 'Try /add <title> to queue a movie.' },
        { name: 'add', description: 'Queue a movie by title', code: 'addMovie',
          args: [{ name: 'title', description: 'Movie title', required: true }] },
      ],
    },
    module,
    context,
  })
  expect(failures).toEqual([])
})
```

Commands with required arguments are skipped: the kit cannot invent a value your enzyme would
accept, so calling them would report correct validation as a failure. Those are yours to test.

## Status

`0.x` — the contract is expected to change. The core's runtime implements it: `bun run
start` answers a `respond:` command directly and dispatches a `code:` command to its
`handlers` entry. Pin an exact version if that matters to you.

## Licence

MIT
