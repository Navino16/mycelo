# @mycelo/septum

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
