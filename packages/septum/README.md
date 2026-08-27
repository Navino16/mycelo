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
septum: "^0.10"
description: Movie shortcuts for Radarr
commands:
  - name: help
    description: command.help.description
    respond: help.text
  - name: add
    description: command.add.description
    code: addMovie
    capabilities: [reactions]
    args:
      - name: title
        description: arg.title.description
        required: true
```

A command carries exactly one of `respond` or `code`, never both and never neither:
`respond` answers with a resolved catalogue key (below), `code` names a handler the module
exports. `args` only makes sense on a `code` command — `respond` has no way to
interpolate one, so declaring it there is rejected. `capabilities` is optional on
every command: the core checks it against the emitting hypha and refuses the command
where it is missing; a command with none works on every channel. An arg's `required` is a
help-surface hint and a conformance obligation, never a gate: the runtime hands the handler
an empty bag when a caller sends too few words, so the handler owns its own usage sentence.

`respond` is a **catalogue key**, resolved in the plugin's own domain against the reader's
locale. A plugin that ships no `translations/` directory is unaffected: an unknown key renders
as itself, literally and without passing through ICU, so `respond: pong` still answers `pong`.
A command's `description` is a catalogue key too, by the same contract, and the core now renders
it: `commands.read`'s `available()` resolves it in the reader's locale. An argument's `description`
is a catalogue key as well; `CommandInfo.args` carries it per `ArgInfo`, rendered the same way and
in declaration order, and is absent when the command declares none. The keys above resolve through
`translations/en.yaml` beside `spore.yaml`:

```yaml
command:
  help:
    description: Show what this plugin can do
  add:
    description: Queue a movie by title
arg:
  title:
    description: Movie title
help:
  text: "Try /add '<title>' to queue a movie."
```

Catalogues are [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax/),
compiled at germination — a syntax error in any key makes the whole spore dormant, not just
that key. Three interactions are worth knowing before writing one:

- A single quote immediately before `{` opens an ICU quoted section and silently eats the
  placeholder: `'{name}'` renders the literal text `{name}`. Double the quote to keep both the
  apostrophe and the interpolation: `''{name}''` renders `'Bob'`.
- A bare `<...>` is ICU's rich-text tag syntax, not a literal — `Try <title> now` throws
  `UNCLOSED_TAG` while the catalogue compiles, which makes the spore dormant. Quote it,
  `'<title>'`, to render it literally.
- A message that declares a placeholder nothing supplies — `{name}` called with no `name` —
  throws at format time, not at germination. The core catches it, logs an error, and renders
  the key in its place, so a bad interpolation degrades to something visible rather than
  crashing the reply.

Every manifest carries `kind`, `name` (lowercase, digits and dashes) and `septum`, the
contract range it targets. `septum` must be a range `Bun.semver` can parse — a caret (`^0.10`), a
comparator (`>=0.10.0`), an `x` range (`0.10.x`) or a pair of comparators (`>=0.9 <0.12`). `*`,
`latest` and anything that fails to parse are **rejected**, because such a range matches every
version there will ever be and would make the core's compatibility check silently inert for that
spore. `description`, `externals` and `requires` are optional everywhere.
Each kind then adds its own:

| Kind | Adds |
|---|---|
| `hypha` | `capabilities`: any of `attachments`, `reactions`, `threads`, `group_membership` |
| `rhiza` | — |
| `enzyme` | `commands`: at least one, each with a `name`, a `description`, and exactly one of `respond` (a catalogue key resolved as a reply) or `code` (a handler name); `code` commands may add `args`; either may add `capabilities` |
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
every spore may require it. `scopes` is mandatory-per-method: each granted scope mounts its own
methods — one, several, or (for `restrictions.manage`) eight — on the object
`ctx.rhiza('mycelium')` returns, exactly as listed below. An ungranted scope's methods are simply
absent, not present-but-rejecting:

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
| `messages.broadcast` | `MessagesBroadcast` | `broadcast(content)` — sends to every operator-configured target, distinct from `messages.send` so replying to one sender never implies writing to everyone |
| `conversations.read` | `ConversationsRead` | `listConversations()` — every conversation the bot has seen, where the channel supplies one |
| `restrictions.manage` | `RestrictionsManage` | context rules, an inhibitor's confined channels, and the broadcast target list — confining an inhibitor's channels takes effect immediately, even for one `enforcing`, with no restart |
| `locale.manage` | `LocaleManage` | `setPrincipalLocale(principalId, locale)`, `setConversationLocale(channel, conversationId, locale)`, `availableLocales()` — the last is synchronous, like `listPlugins()` |
| `commands.read` | `CommandsRead` | `available(principal, locale)` — the commands that principal is *authorized* to invoke, sorted by `qualified`, each with its `description` already rendered in that locale and an optional `args: readonly ArgInfo[]` (absent when the command declares none). Channel capabilities and context rules are applied at dispatch, not here, so a listed command can still be refused on the channel it is asked on |
| `sources.manage` | `SourcesManage` | `listSources()`, `addSource(s)`, `updateSource(id, patch)`, `deleteSource(id)`, `inoculate(request)` — the sporangia a spore can be installed from, and the install itself. A source's `token` is only ever the literal `••••`; a new source is third-party whatever the label says, and the official one can be disabled but never deleted. `inoculate` rejects for an unknown or disabled source, a `local` one, an unknown spore or strain, a directory collision, or an archive that fails validation — every refusal before anything reaches disk |

`listPlugins()` and `availableLocales()` alone are synchronous; every other method returns a promise. The identity and role
methods **reject** rather than resolve quietly when asked about something that does not exist — an
unknown principal id, an unknown role name — and `deleteRole`/`setRoleCommands` also reject on a
`builtin` role such as `owner`, while `createRole` rejects an empty name, a name already taken and a
pattern listed twice. Three exceptions answer instead of rejecting: `getPrincipal` and
`findByIdentity` answer `null` for "not found", since asking is their whole purpose, and `rolesOf`
answers `[]` for an unknown principal, who holds no role either way.

`enable(name)` validates the stored settings against the plugin's own `configSchema` before it
flips the row, and **rejects** with `configuration is incomplete:` followed by the plugin's own
issues, rendered `path: message` and joined with `; `. It rejects for a `secrets` entry the schema
does not declare too, on the same rule germination applies — a config fault that would make the
spore dormant is refused here instead, while the row is still off. `disable(name)`,
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

### `ctx.t` and `ctx.localeFor`

A handler's context, an inhibitor's, and an enzyme's `start()` context each carry
`t(key, params?, locale?)` — a hypha's or a rhiza's does not. A bare string key resolves in the
calling spore's own domain, the same catalogue `respond:` reads. To render another domain's key, pass a `TranslatableRef` instead —
`{ domain, key, params? }` — naming a domain that is either the caller's own, `common` (readable
by every spore, owned by none), or a rhiza the manifest lists in `requires`. Naming any other
domain, including the core's own, **throws**.

Omitting `locale` uses the reader's own language inside a handler, since a message exists to
resolve it from. Everywhere else — an enzyme's `start()`, and both moments of an inhibitor's
life, `start()` **and** `inspect()` — it falls back to `config.defaultLocale` instead: admission
runs before a principal is resolved, so an inhibitor never has a reader to read a language from,
even while judging a real message. `ctx.localeFor(target)` answers the target conversation's own
stored locale, or `config.defaultLocale` — **not** a reader's `/lang` choice, since a push target
carries no principal to consult. Pass its result as `t()`'s third argument for a proactive
`push()` that has no message to derive one from.

A handler's context also carries `locale: string` — the same locale `ctx.t()` uses when `locale`
is omitted, exposed so a handler can pass it to something else that needs it named rather than
rendered, such as a rhiza call. It is not on `EnzymeStartContext`: `start()` has no message to
resolve one from.

Add a `configSchema` when the plugin takes configuration. It is duck-typed rather than typed
as a Zod schema: a plugin is bundled with its own copy of Zod, so its schemas are not
instances of the core's. Anything with a compatible `safeParse` is accepted — and "compatible"
has a stated shape: a refusal's `error` carries `issues`, each an object with `path` (empty for
a whole-object refusal) and `message`:

```ts
import type { ConfigSchema } from '@mycelo/septum'

const configSchema: ConfigSchema<{ apiKey: string }> = {
  safeParse: (input) => {
    const apiKey = (input as { apiKey?: unknown } | null)?.apiKey
    return typeof apiKey === 'string' && apiKey.length > 0
      ? { success: true, data: { apiKey } }
      : { success: false, error: { issues: [{ path: ['apiKey'], message: 'apiKey is required' }] } }
  },
}
```

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

### Declaring a credential

A setting holding a credential is named in `defineConfig`'s second argument:

```ts
import { defineConfig } from '@mycelo/septum'
import type { EnzymeModule } from '@mycelo/septum'
import { z } from 'zod'

export default {
  configSchema: defineConfig(
    z.object({ url: z.url(), apiKey: z.string().min(1) }),
    { secrets: ['apiKey'] },
  ),
  create: () => ({ handlers: {} }),
} satisfies EnzymeModule
```

It belongs on the **default export**: the core reads `configSchema` off that object and nowhere
else, so a named `export const configSchema` is ignored in silence — which here means a credential
stored and served in the clear.

What the core then does, and what it does not:

| | |
|---|---|
| Reading settings | The value is replaced by `••••`, once the row carries the flag — see the limitations below |
| Writing a value equal to `••••` | Ignored, so a form round trip cannot destroy the credential |
| A key `secrets` names but the schema does not declare | The spore is **dormant** and the reason names the key — *only when the schema publishes a closed JSON Schema*, below |
| Storage | **Plain text in the database.** `is_secret` governs redaction on read, not encryption |

Five limitations, stated rather than worked around:

- **A value is only redacted from the write that flagged it.** The core reads `secrets` off the
  plugin's own module, so a value stored before the plugin declared its key — or written while the
  module throws at import, when the declaration cannot be read at all — sits in the database
  unflagged and is returned in the clear. Writing it again, once the declaration is readable,
  promotes the row; nothing else does.
- **The undeclared-key check needs a closed JSON Schema.** A plugin publishing no JSON Schema —
  including a hand-rolled `ConfigSchema` with no `toJsonSchema`, the pattern documented above —
  or one that is explicitly open (`additionalProperties` allowed) is exempt from it: a typo'd
  `secrets` entry then germinates without warning.
- **`••••` cannot be set as a value** on a key declared secret. It is the sentinel the write path
  keys off; writing it to a key that is *not* secret stores it as an ordinary string.
- **A key already stored keeps its flag.** Removing a key from `secrets` does not un-redact a value
  already written as secret — a credential does not stop being one because a later version forgot to
  say so.
- **A written value takes effect after a restart**, like every other plugin setting — declaring a
  key secret changes how it is stored and read back, not when the running spore sees it.

Declaring nothing is unchanged and valid. But an undeclared credential is returned **in the clear**
by the settings route to any authenticated operator, so a spore holding one should say so.

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
| `enzymeChecks` | manifest, config schema, lifecycle, every command invoked with an empty bag, and — given `catalogs` — that every translation key compiles, that every command's `description` resolves in at least one catalogue, and that `ctx.t()` refuses a domain the manifest does not declare |
| `inhibitorChecks` | manifest, config schema, lifecycle, and a verdict per expected allow/deny |

The harness is yours to build: the kit cannot know what your plugin depends on, so you supply
the stubs.

`context()` is the context a *handler* gets. `start()` runs before any message exists and gets the
narrower `EnzymeStartContext` — no `reply`, no `principal`, no `capabilities`, no `locale` — so `enzymeChecks`
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
  locale: 'en',
  on() {},
  t: (key) => (typeof key === 'string' ? key : key.key),
  localeFor: () => Promise.resolve('en'),
})

it('conforms to the Enzyme contract', async () => {
  const failures = await enzymeChecks({
    name: 'radarr-helper',
    manifest: {
      kind: 'enzyme', name: 'radarr-helper', septum: '^0.10',
      commands: [
        { name: 'help', description: 'command.help.description', respond: 'help.text' },
        { name: 'add', description: 'command.add.description', code: 'addMovie',
          args: [{ name: 'title', description: 'arg.title.description', required: true }] },
      ],
    },
    module,
    context,
  })
  expect(failures).toEqual([])
})
```

A command with required arguments is invoked with an empty bag too, exactly as the runtime
invokes it when a caller sends too few words: `required` is a help-surface hint, not a gate.
A handler that throws on the absent argument fails the check; answer with a usage sentence
instead.

Pass `catalogs` — already-parsed translation files keyed by locale, such as
`{ en: parse(readFileSync('translations/en.yaml', 'utf8')) }` — to have `enzymeChecks` compile
every key the same way germination does, and to have `ctx.t()` throw for a domain your manifest
does not declare in `requires`, exactly as the bot would. Every command's `description` must also
resolve in **at least one** of the catalogues you pass: a description that resolves in none is a
literal, and renders as itself in every language. Contributing only some keys for a locale is
fine — a missing key cascades to the default locale, with one warning — as is a catalogue that
parses to `null` or holds no keys at all.

## Status

`0.x` — the contract is expected to change. The core's runtime implements it: `bun run
start` answers a `respond:` command directly and dispatches a `code:` command to its
`handlers` entry. Pin an exact version if that matters to you.

`SEPTUM_VERSION` is exported and equals this package's own `version`, so a plugin that needs to
branch on the contract it was loaded against can read it rather than guess. **A caret range below
`1.0` is bounded, not a floor**: `^0.10` means `>=0.10.0 <0.11.0`, so a `septum:` range written
against one minor excludes the next. The core refuses to germinate a spore whose range excludes the
septum it is running.

## Licence

MIT
