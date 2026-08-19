// A barrel: it preserves the public import path for callers that predate boot/. It must
// import nothing that reaches back here, or bootstrap and startMycelium form a cycle.
export { bootstrap } from './boot/index.js'
export { germinationBanner, startMycelium } from './boot/start.js'
export type { Mycelium, StartMyceliumOptions } from './boot/start.js'
