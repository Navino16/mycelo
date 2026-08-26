# `admin` — the core's test double, not the published spore

There are two `admin`s and they are **allowed to diverge**:

| | this one | `mycelo-spores/spores/admin` |
|---|---|---|
| Purpose | the core's test double | the spore an operator installs |
| Published | never | yes, through the official registry |
| Replies | mostly literal English (`lang`/`lang-group` call `ctx.t` five times) | catalogue keys, `en` + `fr` complete |
| Scopes | all fifteen, pinned against `MYCELIUM_SCOPES` by `admin.test.ts`'s own test | the eleven it actually uses |

Deleting this file breaks **14 tests, and every test in `admin.test.ts` on top of that**, which does
not appear in that count: `admin.test.ts` imports it by path
(`../../../../fixtures/admin/src/index.js`), so removal crashes the whole file at import instead of
failing its tests individually. Measured directly, `bun test` from the repo root: 14 fail, 1 error,
across `help.test.ts` (2), `milestone.test.ts` (9, three of them milestone replays — phases 4, 5.5 and
6 §15), `rhizomorph/locale.test.ts` (1) and `api/milestone.test.ts` (1). They exercise role
assignment, the mycelium's own diagnostics reaching a reader, `/help` filtering, locale resolution,
settings override and context rules. **Do not delete it to remove the duplication.**

`messages.send` and `messages.broadcast` are declared and reached by no command: invoking `send` from
a fixture would push a message during the suite. **Declaring all fifteen scopes here pins nothing
against `MOUNTABLE_SCOPES`**: `MYCELIUM_SCOPES` and `MOUNTABLE_SCOPES` are already pinned symmetrically
against each other, with no manifest involved (`anastomoses.test.ts`, `mycelium-rhiza.test.ts`), and a
synthetic spore already resolves one per mountable scope. Trimming this list to eleven left the whole
suite green until `admin.test.ts` added a test reading this file's `requires:` block directly and
comparing it to `MYCELIUM_SCOPES` — that test, not the two derived pins above, is what a phase-8 author
trimming this list would now break.

`translations/ru.yaml` carries one key on purpose, keeping design §7.2's fallback-with-warning
exercised from disk through germination. `packages/core/test/i18n/translator.test.ts:32` covers the
same mechanism with a stub; this is the end-to-end half. Do not "fix" it by adding keys.
