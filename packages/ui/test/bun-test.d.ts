// Subpath, not `types="bun-types"`: the package root pulls in bun.d.ts's global `Bun`,
// which src/ must never see — this subpath carries only the "bun:test" module declaration.
/// <reference types="bun-types/test" />
