# @mycelo/septum

## 0.10.2

### Added
- `SEPTUM_VERSION`, the running septum's own version. The core reads it to decide whether a
  spore's declared `septum:` range admits the septum actually loaded, rather than duplicating the
  number where the two could drift. A test pins it against `package.json`.
- `PluginInfo.source` and `PluginInfo.strain`, both optional: the sporangium a spore was installed
  from and the strain installed. Both are **absent** for a spore from a local root, which is neither
  versioned nor traceable.
- `SporangiumSource` and `InoculateOutcome`, the shapes the core's sporangium routes answer with. A
  source's `token` is never the stored value — it comes back as the literal `••••` when one is set
  and is absent when not — and `official` is settable through no API: it marks the reviewed
  registry, and a flag an operator could set would be a one-field bypass of the trust model.
- `SourcesManage`, the interface for a `sources.manage` scope that **does not exist yet**. Exported
  now so the core can compile against one shape rather than declaring a second; a plugin cannot
  reach it until the scope ships, and the README deliberately does not list it.

### Changed
- **`septum:` must now be a range `Bun.semver` can parse.** An unparseable range — `*`, `latest`,
  or any typo — matches *every* version, which made the core's compatibility check silently inert
  for that spore instead of failing loudly. `parseManifest` now rejects it with `path: 'septum'`.

  This is **non-breaking for every manifest that exists**: all twenty in the Mycelo project declare
  a caret range, and `^0.10`, `>=0.10.0`, `0.10.x`, `>=0.9 <0.12` and even the doubled-caret
  `^^0.10` all still parse — measured on Bun 1.4.0, and `^^0.10` is measured to behave identically
  to `^0.10`, so it is accepted rather than refused. It **is** a behaviour change for a third-party
  manifest whose range does not parse: such a spore now fails to load, where before it loaded and
  its compatibility was never really checked. Shipped in a patch for that reason — it closes a hole
  rather than moving the contract.

## 0.10.1

### Fixed
- `enzymeChecks` now checks an argument's `description` against the supplied catalogues, the same
  way it already checked a command's own `description`. Before this, a command whose description
  was a real catalogue key but whose *argument* descriptions were literal English strings passed
  conformance — the kit certified a plugin that renders untranslated argument text in `/help` for
  every non-English reader. **Authors: give every `ArgSpec.description` a catalogue key**, exactly
  as `CommandSpec.description` already requires; a description resolving in at least one supplied
  catalogue is enough (design §7.2's partial-catalogue cascade still applies).
- `CHANGELOG.md` now ships in the published tarball (`files`), so a plugin author reading the
  installed package sees the same history as the repository.

## 0.10.0

### Added
- `ArgInfo`, and `CommandInfo.args?: readonly ArgInfo[]` — a command's declared arguments,
  each description already rendered by the core in the reader's locale. Absent, not `[]`,
  for a command declaring none, so a help surface can branch on presence.

### Changed
- **`ArgSpec.required` is a help-surface hint and a conformance obligation, never a gate.**
  The runtime has always handed a handler an empty bag when a caller sends too few words, and
  it still does: a handler owns its own absent-argument answer, which it can phrase in the
  reader's language and with the command's exact syntax. The previous doc comment implied the
  runtime refused the invocation. It did not, and making it do so would render a spore's own
  usage sentence unreachable.
- `enzymeChecks` **invokes** every code command with an empty bag instead of skipping those
  declaring a required argument. A handler that throws on the absent case now fails
  conformance — in production that throw reaches the bus as `command '<name>' failed`.
  **Authors: if a handler assumed a required argument was present, it will fail the kit.**
  Answer your own usage sentence instead.

## 0.9.0

Added:

- `defineConfig(schema, { secrets })` and `ConfigSchema.secrets`: a plugin declares which settings
  hold a credential. The core redacts them on read, refuses to write the redaction mask back over
  one, and makes a spore dormant when `secrets` names a field its schema does not declare — which
  `enable(name)` refuses beforehand, so the operator meets it while the plugin is still off.
- Every conformance kit refuses a `secrets` key the schema does not declare, on the same rule the
  runtime applies — a plugin publishing no JSON Schema, or an explicitly open one, is exempt in
  both.
- Redaction follows the write that flagged the row, so a value stored before its plugin declared the
  key is served in the clear until it is written again.

Settings are still stored as plain text. `is_secret` governs redaction on read, not encryption at
rest; there is no key management in Mycelo, and a key beside the database it protects is theatre.
Additive otherwise: every existing `defineConfig` call and every `ConfigSchema` implementation
compiles unchanged.

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
- `enzymeChecks` now also asserts that every command's `description` resolves in at least one
  supplied `catalogs` entry, so a literal description — which resolves nowhere and renders as
  itself in every language — fails the kit rather than reaching the operator's log. Only *no*
  catalogue resolving it is a failure: a partial contribution for one locale cascades to the
  default with a warning, so demanding every locale would refuse a plugin the runtime germinates.

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
