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

ESM only — `require()` will not work. Developed and tested on Node 24; the conformance kit
calls `module.stripTypeScriptTypes`, so an older runtime will not do. `zod` is a direct
dependency, used to validate manifests.

## A plugin is two files

### `spore.yaml`

The manifest. The core reads it before any plugin code runs, which is why commands and
capabilities are declared here rather than in the module.

```yaml
kind: enzyme
name: upcoming
septum: "^1.0"
description: Lists what is released soon
commands:
  - name: upcoming
    description: Releases in the next N days
    args:
      - name: days
        description: How far ahead to look
        required: false
requires:
  - rhiza: radarr
    scopes: [movies:read]
```

Every manifest carries `kind`, `name` (lowercase, digits and dashes) and `septum`, the
contract range it targets. `description`, `externals` and `requires` are optional everywhere.
Each kind then adds its own:

| Kind | Adds |
|---|---|
| `hypha` | `capabilities`: any of `attachments`, `reactions`, `threads`, `group_membership` |
| `rhiza` | — |
| `enzyme` | `commands`: at least one, each with a `name`, a `description` and optional `args` |
| `inhibitor` | `enforcing`: whether a denial actually blocks, default `false` |

A `requires` entry names one rhiza, with optional `scopes` and `optional: true`. Use
`any_of` instead when two rhizas would both do:

```yaml
requires:
  - any_of:
      - rhiza: radarr
      - rhiza: sonarr
```

`parseManifest` validates the parsed YAML and throws a `ManifestError` naming the offending
field.

### `src/index.ts`

The module. One default export, one `create()` per germination.

```ts
import type { EnzymeModule } from '@mycelo/septum'

export default {
  create: () => ({
    async handle(invocation, ctx) {
      await ctx.reply({ text: `hello, ${ctx.principal.displayName ?? 'stranger'}` })
    },
  }),
} satisfies EnzymeModule
```

Add a `configSchema` when the plugin takes configuration. It is duck-typed rather than typed
as a Zod schema: a plugin is bundled with its own copy of Zod, so its schemas are not
instances of the core's. Anything with a compatible `safeParse` is accepted.

## Conformance kit

`@mycelo/septum/conformance` exports checks a plugin author runs against their own
implementation. Each returns a list of failure strings, so it works with any test runner:

| Export | Checks |
|---|---|
| `hyphaChecks` | manifest, config schema, `start`/`stop`/`send`, `group_membership` consistency |
| `rhizaChecks` | manifest, config schema, `api`, and that `health()` reports rather than throws |
| `enzymeChecks` | manifest, config schema, lifecycle, and every command with no required args |
| `inhibitorChecks` | manifest, config schema, lifecycle, and a verdict per expected allow/deny |
| `erasabilityError` | whether one source string survives Node's type-stripping loader |
| `assertErasable` | the same, as a throwing assertion |
| `sourceErasabilityFailures` | the same over a list of file paths |

The harness is yours to build: the kit cannot know what your plugin depends on, so you supply
the stubs.

```ts
import type { EnzymeContext } from '@mycelo/septum'
import { enzymeChecks } from '@mycelo/septum/conformance'
import { expect, it } from 'vitest'
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
    name: 'upcoming',
    manifest: { kind: 'enzyme', name: 'upcoming', septum: '^1.0', commands: [
      { name: 'upcoming', description: 'Releases in the next N days' },
    ] },
    module,
    sourcePaths: [new URL('../src/index.ts', import.meta.url).pathname],
    context,
  })
  expect(failures).toEqual([])
})
```

Commands with required arguments are skipped: the kit cannot invent a value your enzyme would
accept, so calling them would report correct validation as a failure. Those are yours to test.

## Erasability

`sourcePaths` is optional but worth passing. It asks Node whether your source can be loaded by
its type-stripping loader, which is how Mycelo's `local` driver loads a plugin during
development. A plugin can work when bundled and break when loaded unbundled, so the check
exists to catch that before your users do: **no enums, no decorators, no namespaces, no
parameter properties**.

## Status

`0.x` — the contract is expected to change. It has not yet been implemented by a real runtime;
that happens in the core's phase 2, which is the first genuine test of whether these interfaces
are implementable. Pin an exact version if that matters to you.

## Licence

MIT
