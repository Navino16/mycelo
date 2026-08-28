import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach } from 'bun:test'
import { setLocaleHeader } from '../src/api/client.ts'

// Per-file registration fails: `screen`'s CJS singleton binds too early under Bun
// (task-1-report.md finding 3). disableSameOriginPolicy: core's real-server tests fetch
// other localhost ports. url: happy-dom's 'about:blank' default breaks createBrowserRouter.
GlobalRegistrator.register({
  url: 'http://localhost/',
  settings: { fetch: { disableSameOriginPolicy: true } },
})

// RTL's `afterEach(cleanup)` runs once, in whichever file's import graph first evaluates its
// module (measured on Bun 1.4.0) — a dynamic import from THIS preload makes that file the
// preload, so the hook applies before every test file. This registration is a second, idempotent one.
const { cleanup } = await import('@testing-library/react')
afterEach(cleanup)

// Process-global state that survives `cleanup()`: localStorage, and client.ts's module-level
// locale (nothing else resets it). Without this, a locale switched in one file's test leaks
// into every test that runs after it, in any file, for the rest of the process.
afterEach(() => {
  globalThis.localStorage?.clear()
  setLocaleHeader('en')
})
