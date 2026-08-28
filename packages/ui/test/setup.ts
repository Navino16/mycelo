import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Per-file registration was measured to fail: @testing-library/dom's CJS `screen` singleton
// observably evaluates before that ordering takes effect under Bun (task-1-report.md, finding 3).
// disableSameOriginPolicy: packages/core's real-server tests fetch other localhost ports.
GlobalRegistrator.register({ settings: { fetch: { disableSameOriginPolicy: true } } })
