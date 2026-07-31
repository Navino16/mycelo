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

## Conformance kit

`@mycelo/septum/conformance` exports checks a plugin author runs against their own
implementation. Each returns a list of failure strings, so it works with any test runner:

```ts
import { enzymeChecks } from '@mycelo/septum/conformance'

it('conforms to the Enzyme contract', async () => {
  expect(await enzymeChecks(harness)).toEqual([])
})
```

It also carries `erasabilityError`, which asks Node whether your source can be loaded by its
type-stripping loader. That matters because a plugin can work when bundled and break when loaded
unbundled: **no enums, no decorators, no namespaces, no parameter properties**.

## Status

`0.x` — the contract is expected to change. It has not yet been implemented by a real runtime;
that happens in the core's phase 2, which is the first genuine test of whether these interfaces
are implementable. Pin an exact version if that matters to you.

## Licence

MIT
