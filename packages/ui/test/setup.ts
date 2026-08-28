import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach } from 'bun:test'

// Per-file registration fails: `screen`'s CJS singleton binds too early under Bun
// (task-1-report.md finding 3). disableSameOriginPolicy: core's real-server tests fetch
// other localhost ports. url: happy-dom's 'about:blank' default breaks createBrowserRouter.
GlobalRegistrator.register({
  url: 'http://localhost/',
  settings: { fetch: { disableSameOriginPolicy: true } },
})

// RTL's auto-cleanup checks `typeof afterEach`, which Bun only defines per file import,
// not as a true global — so registration is file-order-dependent and can silently no-op.
// Imported dynamically for the same before-registration reason `screen` above requires.
const { cleanup } = await import('@testing-library/react')
afterEach(cleanup)
