// Configuration for npm-check-updates.
//
// Two dependencies are deliberately held back: raising either breaks something no
// version checker can see.
export default {
  reject: [
    // Must track the major of the Node runtime pinned in .nvmrc. Newer types describe
    // APIs the runtime does not have: the compiler accepts the code and it crashes.
    '@types/node',

    // typescript-eslint peers `typescript@">=4.8.4 <6.1.0"`, so TypeScript 7 means
    // giving up type-aware linting entirely. Revisit when it supports 7.
    'typescript',
  ],
}
