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
septum: "^0.7"
description: Movie shortcuts for Radarr
commands:
  - name: help
    description: Show what this plugin can do
    respond: "Try /add <title> to queue a movie."
  - name: add
    description: Queue a movie by title
    code: addMovie
    capabilities: [reactions]
    args:
      - name: title
        description: Movie title
        required: true
```

A command carries exactly one of `respond` or `code`, never both and never neither:
`respond` is a fixed string sent back untouched, `code` names a handler the module
exports. `args` only makes sense on a `code` command — `respond` has no way to
interpolate one, so declaring it there is rejected. `capabilities` is optional on
every command: the core checks it against the emitting hypha and refuses the command
where it is missing; a command with none works on every channel.

Every manifest carries `kind`, `name` (lowercase, digits and dashes) and `septum`, the
contract range it targets. `description`, `externals` and `requires` are optional everywhere.
Each kind then adds its own:

| Kind | Adds |
|---|---|
| `hypha` | `capabilities`: any of `attachments`, `reactions`, `threads`, `group_membership` |
| `rhiza` | — |
| `enzyme` | `commands`: at least one, each with a `name`, a `description`, and exactly one of `respond` (a fixed text reply) or `code` (a handler name); `code` commands may add `args`; either may add `capabilities` |
| `inhibitor` | `enforcing`: how an *error* from this inhibitor is handled, default `false` |

### `enforcing` governs errors, never refusals

A refusal is always final. `inspect()` returning `{ allow: false, reason: '...' }` refuses the
message whether the inhibitor is `enforcing` or not — an advisory inhibitor is not a dry run.
`reason` is required — `Verdict`'s `allow: false` branch has no default — and the core surfaces it
to the operator, so a plugin author cannot skip it. `enforcing` decides only what happens when the
inhibitor *fails*:

| `inspect()` | advisory (default) | `enforcing: true` |
|---|---|---|
| returns `{ allow: false, reason }` | message refused | message refused |
| throws | skipped with a warning | **all traffic refused** |

The same applies before any message arrives: an `enforcing` inhibitor that never became usable —
rejected config, a throwing `start()`, a module that will not load, a manifest the schema rejects —
refuses all traffic, rather than leaving the channel it guarded open. An advisory one in that state
is simply absent.

A refusal is **silent on the channel**: the core sends nothing back, so a sender with no right to
address the bot learns nothing from it.

`InhibitorContext` also carries `requireCapability(channel, capability)`. Call it from `start()`:
it throws when that channel cannot enforce a rule the inhibitor depends on — asking a channel with
no `group_membership` to police group members, for instance. The throw makes the inhibitor dormant,
which for an `enforcing` one means all traffic is then refused. That is the point: a security rule
must never be silently inert.

```ts
import type { InhibitorContext } from '@mycelo/septum'

function start(ctx: InhibitorContext<{ channel: string }>): Promise<void> {
  ctx.requireCapability(ctx.config.channel, 'group_membership')
  return Promise.resolve()
}
```

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
every spore may require it. `scopes` is mandatory-per-method: each granted scope mounts its
methods on the object `ctx.rhiza('mycelium')` returns — one for most scopes, three for
`principals.read` and `roles.manage` — and an ungranted scope's methods are simply absent, not
present-but-rejecting:

| Scope | Interface | Mounts |
|---|---|---|
| `plugins.read` | `PluginsRead` | `listPlugins(): readonly PluginInfo[]` |
| `health.read` | `HealthRead` | `health(): Promise<readonly RhizaHealth[]>` |
| `messages.send` | `MessagesSend` | `send(target, content): Promise<void>` |
| `principals.read` | `PrincipalsRead` | `listPrincipals()`, `getPrincipal(id)`, `findByIdentity(channel, externalId)` |
| `principals.manage` | `PrincipalsManage` | `markReviewed(id)`, `setDisplayName(id, displayName)` |
| `roles.read` | `RolesRead` | `listRoles()`, `rolesOf(principalId)` |
| `roles.assign` | `RolesAssign` | `assignRole(principalId, roleName)`, `revokeRole(principalId, roleName)` |
| `roles.manage` | `RolesManage` | `createRole(name, patterns)`, `setRoleCommands(name, patterns)`, `deleteRole(name)` |
| `plugins.toggle` | `PluginsToggle` | `enable(name)`, `disable(name)` |
| `plugins.configure` | `PluginsConfigure` | `settings(name)`, `setSetting(name, key, value)`, `formSchema(name)` |
| `conversations.read` | `ConversationsRead` | `listConversations()` — every conversation the bot has seen, with a readable `label` |
| `messages.broadcast` | `MessagesBroadcast` | `broadcast(content)` — sends to every operator-configured target, distinct from `messages.send` so replying to one sender never implies writing to everyone |
| `restrictions.manage` | `RestrictionsManage` | context rules, an inhibitor's confined channels, and the broadcast target list |

`listPlugins()` alone is synchronous; every other method returns a promise. The identity and role
methods **reject** rather than resolve quietly when asked about something that does not exist — an
unknown principal id, an unknown role name — and `deleteRole`/`setRoleCommands` also reject on a
`builtin` role such as `owner`, while `createRole` rejects an empty name, a name already taken and a
pattern listed twice. Three exceptions answer instead of rejecting: `getPrincipal` and
`findByIdentity` answer `null` for "not found", since asking is their whole purpose, and `rolesOf`
answers `[]` for an unknown principal, who holds no role either way.

`enable(name)` validates the stored settings against the plugin's own `configSchema` before it
flips the row, and **rejects** with `configuration is incomplete:` followed by whatever that
schema reported — a Zod error dump, or the string a hand-built `ConfigSchema` returned; how
precisely the fault is named is the plugin author's choice, not the core's. `disable(name)`,
`settings(name)` and `setSetting(...)` reject for a plugin that is not installed. `setSetting`
also rejects a key the plugin's published JSON Schema neither declares nor allows as an
additional property — such a key would be dropped silently by a loose schema, or block
`enable()` outright by a strict one; either way the write would be confirmed and never take
effect. `settings(name)` never returns a value stored as a secret: it answers `••••` in its
place, which is what makes `plugins.configure` a lesser grant than the credential store it would
otherwise expose. `formSchema(name)` is the one method that never rejects — every fault,
including a spore that throws at import, comes back as `{ available: false, reason }`.

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

`defineConfig` wraps a Zod schema into that shape and adds `toJsonSchema()`, which the settings
form is generated from. It uses septum's own bundled Zod, so the schema and the converter always
come from the same copy:

```ts
import { defineConfig } from '@mycelo/septum'
import { z } from 'zod'

const configSchema = defineConfig(z.object({ apiKey: z.string().min(1) }))
```

`toJsonSchema` is optional on `ConfigSchema` itself, so a plugin author who builds the shape by
hand rather than through `defineConfig` may omit it — the plugin still germinates, it just gets
no generated form.

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
| `hyphaChecks` | manifest, config schema, `connect`/`listen`/`stop`/`send`, `group_membership` consistency, and — given a `membershipGroupId` — that `listGroupMembers` resolves an array |
| `rhizaChecks` | manifest, config schema, `api`, and that `health()` reports rather than throws |
| `enzymeChecks` | manifest, config schema, lifecycle, and every command with no required args |
| `inhibitorChecks` | manifest, config schema, lifecycle, and a verdict per expected allow/deny |

The harness is yours to build: the kit cannot know what your plugin depends on, so you supply
the stubs.

`context()` is the context a *handler* gets. `start()` runs before any message exists and gets the
narrower `EnzymeStartContext` — no `reply`, no `principal`, no `capabilities` — so `enzymeChecks`
narrows `context()` down to those members before calling `start()`. An enzyme that reaches for
`ctx.reply` in `start()` therefore fails the kit exactly as it would fail in the bot. Pass
`startContext()` instead if you want to stub that moment yourself.

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
      kind: 'enzyme', name: 'radarr-helper', septum: '^0.7',
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
