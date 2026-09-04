// A module declaration, not a global: the ui program deliberately keeps Bun's and Node's
// globals out of src/ (see bun-test.d.ts), and only the tone probe needs to read source files.
declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
}
