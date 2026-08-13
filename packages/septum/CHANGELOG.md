# @mycelo/septum

## 0.6.0

Added:

- `defineConfig(schema)`: wraps a Zod schema into `ConfigSchema`, adding `toJsonSchema()` for the
  phase 9 settings form. Uses septum's own bundled Zod, so the schema and the converter come from
  the same copy.
- `ConfigSchema.toJsonSchema?()`, optional so a hand-built `ConfigSchema` need not supply one.
- `FormSchema`: what `PluginsConfigure.formSchema()` resolves to for one plugin's form.
- `plugins.configure`, a tenth `MyceliumScope`, and the `PluginsConfigure` interface it mounts:
  `settings(name)` (secrets redacted to `••••`), `setSetting(name, key, value)`, `formSchema(name)`.
- `PluginsToggle`, the interface `plugins.toggle` mounts: `enable(name)`, `disable(name)`. The scope
  already parsed but mounted nothing and left the spore dormant; it now works.

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
