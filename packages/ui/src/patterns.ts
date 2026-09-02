/** Mirrors the core's authorize() (packages/core/src/authorization/check.ts): exactly these three forms. */
export function grants(patterns: readonly string[], qualified: string): boolean {
  const dot = qualified.indexOf('.')
  const plugin = dot === -1 ? qualified : qualified.slice(0, dot)
  return patterns.some((p) => p === '*' || p === `${plugin}.*` || p === qualified)
}

/** 'all' means a wildcard covers the plugin, which the editor renders as a wildcard. */
export function coversPlugin(
  patterns: readonly string[], plugin: string,
): 'all' | 'some' | 'none' {
  if (patterns.includes('*') || patterns.includes(`${plugin}.*`)) return 'all'
  // Excludes a stray '*' elsewhere in the pattern: a near-miss such as 'admin.pl*' is not
  // one of authorize()'s three forms and must not count as partial coverage either.
  return patterns.some((p) => p.startsWith(`${plugin}.`) && !p.includes('*')) ? 'some' : 'none'
}

export function wildcardsIn(patterns: readonly string[]): readonly string[] {
  return patterns.filter((p) => p === '*' || p.endsWith('.*'))
}
