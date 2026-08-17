// A re-export barrel, so `boot/germinate.ts` can reach `startMycelium` without importing
// the module that exports `bootstrap`: that pair would be a runtime import cycle.
export { bootstrap } from './boot/index.js'
export { germinationBanner, startMycelium } from './boot/start.js'
export type { Mycelium, StartMyceliumOptions } from './boot/start.js'
