// Configuration for npm-check-updates.
//
// Two dependencies are deliberately held back. They are not stale: raising either
// breaks something that no version checker can see, so they are rejected here
// rather than left to be re-discovered — and re-argued — every time someone runs
// `ncu -u`.
export default {
  reject: [
    // Must track the major of the Node runtime, currently >=24.19.0.
    // Types from Node 26 describe APIs the Node 24 runtime does not have: the
    // compiler accepts the code and it crashes at runtime. Raise this only
    // together with engines.node.
    '@types/node',

    // typescript-eslint peers `typescript@">=4.8.4 <6.1.0"` in both latest and
    // canary, so TypeScript 7 means giving up type-aware linting entirely —
    // no-floating-promises in particular, on a codebase that is async throughout.
    // Revisit when typescript-eslint supports 7; it is a version bump, not a
    // code change.
    'typescript',
  ],
}
