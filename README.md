# Mycelo

A self-hosted, multi-channel chat bot assembled entirely from plugins.

Channels, connected systems, commands and inbound filters are **all plugins**, installed from
git-based registries. The core holds no domain logic: it discovers plugins, validates their
manifests, resolves their dependency graph, and routes messages between them.

```
Signal ─┐                      ┌─ Radarr
        ├─ mycelium ─ commands ┤
Discord ┘                      └─ Plex
```

## Status

**Early development.** The plugin contract is published as
[`@mycelo/septum`](https://www.npmjs.com/package/@mycelo/septum), currently at `0.2.0` on the
registry — the `0.3.0` in this tree has not been published yet. The runtime now germinates
plugins and routes commands between them, but the only hypha that exists is a `console` test
fixture: no channel plugin, and so no released bot, exists yet.

| | |
|---|---|
| Contract (`@mycelo/septum`) | published, `0.x`, expected to change |
| Runtime | phases 1–2.5 done; anastomoses next |
| Admin UI | not started |
| Plugin registry ([mycelo-spores](https://github.com/Navino16/mycelo-spores)) | empty |

## Vocabulary

Borrowed from mycology, because a mycelium is a network that spreads by branching, hooks onto
foreign organisms to exchange resources, and propagates through transportable units — which is,
structurally, a plugin architecture.

| Term | Meaning |
|---|---|
| `mycelium` | The runtime |
| `hypha` | A channel plugin — Signal, Discord |
| `rhiza` | A connected-system plugin — Radarr, Plex |
| `enzyme` | A command plugin |
| `inhibitor` | A filter plugin — decides who may be heard |
| `spore` | The distributable package of a plugin |
| `sporangium` | A plugin registry |

## Development

Requires [Bun](https://bun.sh) `1.3.14` (see `.bun-version`).

```sh
bun install
bun run ci      # lint + typecheck + test
bun run start   # runs from source, no build step
```

Work happens on `develop`; `main` holds released state.

## Licence

MIT
