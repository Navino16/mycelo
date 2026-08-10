import type { ArgSpec } from '@mycelo/septum'

export interface ParsedCommand {
  command: string
  args: Record<string, string>
  rest: string
}

/**
 * `<prefix><command> <rest>`. Routing is by command name only, never by free text
 * (spec §3.1): the core must know what to authorize before invoking a handler.
 */
export function parseCommand(text: string, prefix: string): ParsedCommand | null {
  if (!text.startsWith(prefix)) return null
  const body = text.slice(prefix.length).trim()
  if (body === '') return null
  const space = body.indexOf(' ')
  const command = space === -1 ? body : body.slice(0, space)
  const rest = space === -1 ? '' : body.slice(space + 1).trim()
  if (!/^[a-z][a-z0-9-]*$/.test(command)) return null
  return { command, args: {}, rest }
}

/**
 * Positional binding against the manifest's arg specs. The last declared arg absorbs
 * the remainder, so a trailing free-text argument does not need quoting.
 */
export function bindArgs(rest: string, specs: readonly ArgSpec[] = []): Record<string, string> {
  const args: Record<string, string> = {}
  if (specs.length === 0) return args
  let remainder = rest
  specs.forEach((spec, i) => {
    if (remainder === '') return
    if (i === specs.length - 1) {
      args[spec.name] = remainder
      remainder = ''
      return
    }
    const space = remainder.indexOf(' ')
    if (space === -1) {
      args[spec.name] = remainder
      remainder = ''
    } else {
      args[spec.name] = remainder.slice(0, space)
      remainder = remainder.slice(space + 1).trim()
    }
  })
  return args
}
