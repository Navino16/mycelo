/**
 * Three pattern forms and no more: `*`, `plugin.*`, `plugin.command` (spec §5.2). A general
 * glob would make a principal's effective rights impossible to display in the phase 9 UI.
 */
export function authorize(qualified: string, patterns: readonly string[]): boolean {
  const dot = qualified.indexOf('.')
  const plugin = dot === -1 ? qualified : qualified.slice(0, dot)
  return patterns.some((pattern) => {
    if (pattern === '*') return true
    if (pattern === `${plugin}.*`) return true
    return pattern === qualified
  })
}
