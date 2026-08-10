import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { Enzyme, EnzymeModule } from '@mycelo/septum'

/**
 * A declarative enzyme is a YAML module, not a widened manifest (spec §4.1). The
 * manifest keeps declaring the commands; this file only says what each answers.
 */
const declarativeSchema = z.object({
  responses: z.record(z.string(), z.string()),
})

export const DECLARATIVE_ENTRY = 'enzyme.yaml'

export function hasDeclarativeEntry(sporePath: string): boolean {
  return existsSync(join(sporePath, DECLARATIVE_ENTRY))
}

/**
 * Builds a module from enzyme.yaml. `declaredCommands` comes from the manifest, so a
 * response for a command nobody declared is a germination failure rather than dead
 * text the author never sees run.
 */
export function loadDeclarative(
  sporePath: string,
  declaredCommands: readonly string[],
): EnzymeModule {
  const file = join(sporePath, DECLARATIVE_ENTRY)
  const parsed = declarativeSchema.safeParse(parseYaml(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${DECLARATIVE_ENTRY} is invalid at '${issue?.path.join('.') ?? ''}': ${issue?.message ?? ''}`)
  }
  const responses = parsed.data.responses

  const undeclared = Object.keys(responses).filter((c) => !declaredCommands.includes(c))
  if (undeclared.length > 0) {
    throw new Error(`${DECLARATIVE_ENTRY} answers undeclared commands: ${undeclared.join(', ')}`)
  }
  const unanswered = declaredCommands.filter((c) => responses[c] === undefined)
  if (unanswered.length > 0) {
    throw new Error(`${DECLARATIVE_ENTRY} has no response for: ${unanswered.join(', ')}`)
  }

  const enzyme: Enzyme = {
    async handle(invocation, ctx) {
      const text = responses[invocation.command]
      if (text !== undefined) await ctx.reply({ text })
    },
  }
  return { create: () => enzyme }
}
