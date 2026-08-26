// Configuration for npm-check-updates.
//
// Four entries are rejected for three reasons: the Node and Bun runtime pins and
// the TypeScript peer range. Raising any breaks something no version checker can see.
export default {
  reject: [
    // Must track the major of the Node runtime pinned in .nvmrc. Newer types describe
    // APIs the runtime does not have: the compiler accepts the code and it crashes.
    '@types/node',

    // typescript-eslint peers `typescript@">=4.8.4 <6.1.0"`, so TypeScript 7 means
    // giving up type-aware linting entirely. Revisit when it supports 7.
    'typescript',

    // Must track the Bun runtime pinned in .bun-version, same argument as @types/node.
    '@types/bun',
    'bun-types',
  ],
}
