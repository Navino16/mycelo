import { GlobalRegistrator } from '@happy-dom/global-registrator'

// The preload is repository-wide (bunfig.toml), not scoped to packages/ui: without disabling
// same-origin policy, happy-dom's global fetch treats every other package's real-server
// integration tests (a different localhost port) as cross-origin and rejects them.
GlobalRegistrator.register({ settings: { fetch: { disableSameOriginPolicy: true } } })
