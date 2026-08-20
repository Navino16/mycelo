# @mycelo/septum

## 0.8.0

**Breaking.** `ConfigSchema.error` takes a shape instead of `unknown`: `ConfigError { readonly
issues: readonly ConfigIssue[] }`, each issue `{ readonly path: readonly PropertyKey[]; readonly
message: string }`. Migration: a schema built with `defineConfig`, or any Zod schema, already
satisfies it — a `ZodError` is assignable to `ConfigError`. A **hand-written** `ConfigSchema` must
now return that shape rather than a bare string or an arbitrary object. The conformance kit now
checks a refusal's shape too, so a hand-written schema that previously reported "conforms" may fail
now — which is the point: the core renders those issues into the sentence an operator sees. An empty
`path` is a refusal about the settings object as a whole, such as a top-level Zod `.refine()`: the
core reports it against every key the write carried, so a form can highlight them all.

**Breaking.** `EnzymeContext.locale: string` is a new required member: the locale the core resolved
for the message being answered, the same one `ctx.t()` uses when none is given. It is on
`EnzymeContext` and deliberately **not** on `EnzymeStartContext`, since `start()` answers no
message — the same asymmetry `principal` and `capabilities` already have. Migration: the
conformance kit's `EnzymeContext` stub is written by the plugin author, not built by the kit, so
every author's own test harness must add `locale` to the context it passes in. Nothing else changes
for them.

Added:

- `commands.read`, the fifteenth `MyceliumScope`, and the `CommandsRead` interface it mounts:
  `available(principal, locale)` — the commands that principal is *authorized* to invoke, sorted by
  `qualified`, each with its `description` already rendered in that locale. Channel capabilities and
  context rules are applied at dispatch, not here, so a listed command can still be refused on the
  channel it is asked on. `CommandInfo`: `qualified`, `name`, `plugin`, `description`. This is why a
  command's `description:` is now rendered rather than merely declared to be a catalogue key.
- `enzymeChecks` now also asserts that every command's `description` resolves in each supplied
  `catalogs` entry that has any keys at all, so a literal description — which renders as itself and
  logs a missing translation for every caller — fails the kit rather than the operator's log. A
  catalogue that parses to `null` or holds no keys is still the scaffolded-empty case and is skipped.

## 0.7.0

**Breaking.** `respond:` is resolved as a catalogue key in the declaring spore's own domain by
the core, rather than sent as literal text. Migration: none required for most plugins — an
absent key still renders literally, so a `respond:` with no matching translation, or a spore with
no catalogue at all, is unaffected. By the same contract a command's and an argument's
`description` are catalogue keys too, though nothing renders them yet (deferred to phase 9).

Added:

- `ctx.t(key, params?, locale?)` on `EnzymeContext`, `EnzymeStartContext` and `InhibitorContext`.
  A bare string key resolves in the calling spore's own domain; a `TranslatableRef`
  (`{ domain, key, params? }`) names another domain — the caller's own, `common`, or a rhiza the
  manifest lists in `requires`. Naming any other domain, including the core's own, throws.
- `ctx.localeFor(target)` on `EnzymeStartContext` (and `EnzymeContext`, which extends it): the
  target conversation's own stored locale, or `config.defaultLocale` — never a reader's own
  `/lang` choice, since a push target carries no principal to consult.
- `TranslatableRef`, `Translate`: the types `ctx.t` is built from.
- `LocaleManage`, a 14th `MyceliumScope`, `locale.manage`: `setPrincipalLocale`,
  `setConversationLocale`, `availableLocales()`.
- `ConversationInfo`, `ConversationsRead`, `BroadcastResult`, `MessagesBroadcast`: mounted by two
  new scopes, `conversations.read` and `messages.broadcast`.
- `ContextRule`, `RestrictionsManage`: mounted by a new scope, `restrictions.manage` — confining
  an inhibitor to named channels, a command pattern to `dm` or `group`, and configuring broadcast
  targets.
- `CONVERSATION_KINDS`: `ConversationKind` is now derived from this runtime constant, the same
  shape `MyceliumScope` already uses.
- `EnzymeHarness.catalogs`: already-parsed translation catalogues, keyed by locale, that
  `enzymeChecks` compiles the same way germination does, and uses to enforce the same
  domain-declaration rule `ctx.t()` enforces at runtime.
- A new dependency, `intl-messageformat` (`^11.2.13`), needed for the conformance kit to compile a
  harness's catalogues the same way the runtime does.

## 0.6.0

Added:

- `defineConfig(schema)`: wraps a Zod schema into `ConfigSchema`, adding `toJsonSchema()` for the
  phase 9 settings form. Uses septum's own bundled Zod, so the schema and the converter come from
  the same copy.
- `ConfigSchema.toJsonSchema?()`, optional so a hand-built `ConfigSchema` need not supply one.
- `FormSchema`: what `PluginsConfigure.formSchema()` resolves to for one plugin's form.
- `plugins.configure`, a tenth `MyceliumScope`, and the `PluginsConfigure` interface it mounts:
  `settings(name)` (secrets redacted to `••••`), `setSetting(name, key, value)` (rejects a key
  the plugin's own JSON Schema neither declares nor allows), `formSchema(name)`.
- `PluginsToggle`, the interface `plugins.toggle` mounts: `enable(name)`, `disable(name)`. The scope
  already parsed but mounted nothing and left the spore dormant; it now works.
- `PluginInfo.enabled`, and a third `state` value, `'disabled'`: a plugin an operator disabled
  never reaches germination, so it never had a registry entry to report through `listPlugins()`
  at all until now.

The conformance kit now rejects a `configSchema.toJsonSchema` that is present but not callable,
across `hyphaChecks`, `rhizaChecks`, `enzymeChecks` and `inhibitorChecks`.

## 0.4.0

**Breaking.** `Hypha.start(ctx)` is replaced by `connect(ctx)` followed by `listen()`. Migration:
split a plugin's old `start()` into a `connect()` that opens the channel client (after which
`send()` works) and a `listen()` that opens the gate to `ctx.emit` — the core now calls `connect()`
on every hypha before any enzyme starts, then `listen()` only once every enzyme has started, so a
push from an enzyme's own `start()` reaches a connected but not-yet-listening channel.

**Breaking.** A requirement's `scopes` no longer accepts a free string: it is now
`z.array(z.enum(MyceliumScope))`, and a misspelled scope is rejected at manifest parse time
instead of being silently ignored. Migration: use one of the exported `MYCELIUM_SCOPES` values.

Removed:

- `ScopeDeniedError`. It was unreachable in practice — the mycelium's scope model is enforced by
  a denied scope's method simply not existing on the object, never by a throw — and this version
  had not shipped yet, so nothing depended on it.

Added:

- `MYCELIUM_SCOPES` and `MyceliumScope`: the enumeration `requires[].scopes` now validates against.
- `PluginInfo`, `RhizaHealth`: the shapes `ctx.rhiza('mycelium')` returns.
- `PluginsRead`, `HealthRead`, `MessagesSend`: one interface per mountable mycelium scope, so a
  plugin can typecheck against exactly the methods its declared scopes grant.

## 0.3.0

**Breaking.** The erasability conformance subsystem is removed. Mycelo now runs on Bun, which
compiles TypeScript rather than stripping types, so a plugin is no longer required to avoid `enum`,
`namespace`, parameter properties and decorators. The check that enforced that rule had no meaning
left, and could not run on Bun in any case: it imported `stripTypeScriptTypes` from `node:module`,
which Bun does not implement.

Removed:

- `erasabilityError(source: string): string | null`
- `assertErasable(source: string): void`
- `sourceErasabilityFailures(paths: readonly string[] | undefined): Promise<string[]>`
- `sourcePaths` on `EnzymeHarness`, `HyphaHarness`, `InhibitorHarness` and `RhizaHarness`

Added:

- A `bun` export condition on both entry points, resolving to TypeScript source. Node consumers are
  unaffected and continue to resolve `dist/`.

Also: `engines.node` is dropped. The package no longer imports anything from `node:` and runs under
any runtime.
