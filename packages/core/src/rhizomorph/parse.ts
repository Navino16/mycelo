import type { ArgSpec } from '@mycelo/septum'

/**
 * What a caller can actually type after the prefix. Exported because an alias is validated
 * against it: an alias this refuses is a stored value with no effect (spec §3.1).
 */
export const COMMAND_NAME = /^[a-z][a-z0-9-]*$/

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
  if (!COMMAND_NAME.test(command)) return null
  return { command, args: {}, rest }
}

/**
 * Positional binding against the manifest's arg specs. The last declared arg absorbs
 * the remainder, so a trailing free-text argument does not need quoting.
 *
 * `spec.required` is never read here, deliberately: design §5 (phase 7.6) rules it a
 * `/help` hint and a conformance obligation, not a core gate — a spore's own usage
 * sentence, in its own catalogue, beats a generic refusal the core could give instead.
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
