# `admin` — the core's test double, not the published spore

There are two `admin`s and they are **allowed to diverge**:

| | this one | `mycelo-spores/spores/admin` |
|---|---|---|
| Purpose | the core's test double | the spore an operator installs |
| Published | never | yes, through the official registry |
| Replies | literal English | catalogue keys, `en` + `fr` complete |
| Scopes | all fifteen, so `mycelo`'s CI keeps seeing each one declared by a manifest | the eleven it actually uses |

Thirteen tests depend on this file, three of them milestone replays (phases 4, 5.5 and 6 §15). They
use it to exercise role assignment, the mycelium's own diagnostics reaching a reader, `/help`
filtering, locale resolution, settings override and context rules. **Do not delete it to remove the
duplication** — phase 7.6 measured that and the thirteen failures are in its plan.

`messages.send` and `messages.broadcast` are declared and reached by no command: invoking `send` from
a fixture would push a message during the suite. Declaring them is what pins them against
`MOUNTABLE_SCOPES`.

`translations/ru.yaml` carries one key on purpose, keeping design §7.2's fallback-with-warning
exercised from disk through germination. `packages/core/test/i18n/translator.test.ts:32` covers the
same mechanism with a stub; this is the end-to-end half. Do not "fix" it by adding keys.
