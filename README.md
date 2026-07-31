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

**Early development.** The plugin contract exists and is published as
[`@mycelo/septum`](https://www.npmjs.com/package/@mycelo/septum); the runtime that loads plugins
is not written yet. Nothing here is usable as a bot today.

| | |
|---|---|
| Contract (`@mycelo/septum`) | published, `0.x`, expected to change |
| Runtime | not started |
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

Requires Node `>=24.18.0`.

```sh
npm install
npm run ci      # lint + typecheck + test
```

Work happens on `develop`; `main` holds released state.

## Licence

MIT
