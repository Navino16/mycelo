import type {
  EnzymeModule, PluginsConfigure, PluginsRead, PluginsToggle, PrincipalsRead, RolesAssign,
  RolesManage, RolesRead,
} from '@mycelo/septum'

// JSON first, raw string as the fallback: a chat channel has no types, and Zod must receive
// 8080 as a number while http://x is not valid JSON and has to stay a string.
function coerce(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return raw }
}

export default {
  create: () => ({
    handlers: {
      handlePlugins: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsRead>('mycelium')
        const names = mycelium.listPlugins().map((p) => p.name).join(', ')
        await ctx.reply({ text: names })
      },
      handleWhoami: async (invocation, ctx) => {
        const { channel, externalId } = invocation.message.sender
        const roles = ctx.principal.roles.join(', ') || 'none'
        await ctx.reply({ text: `${channel}:${externalId} roles: ${roles}` })
      },
      handleRoles: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<RolesRead>('mycelium')
        const roles = await mycelium.listRoles()
        const text = roles.map((r) => `${r.name}: ${r.patterns.join(', ') || 'none'}`).join('; ')
        await ctx.reply({ text })
      },
      handleGrant: async (invocation, ctx) => {
        const { role, who } = invocation.args
        // noUncheckedIndexedAccess widens Invocation.args to string | undefined per key,
        // and a caller can genuinely omit a required arg by sending too few words.
        if (role === undefined || who === undefined) {
          await ctx.reply({ text: 'usage: grant <role> <who>' })
          return
        }
        const identity = await ctx.rhiza<PrincipalsRead>('mycelium').findByIdentity(invocation.message.channel, who)
        if (identity === null) {
          await ctx.reply({ text: `no identity '${who}' on channel '${invocation.message.channel}'` })
          return
        }
        // The mycelium curates its own diagnostics ("role 'x' does not exist"); letting the
        // throw reach the bus would replace them all with "command 'grant' failed".
        try {
          await ctx.rhiza<RolesAssign>('mycelium').assignRole(identity.id, role)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: `granted '${role}' to ${who}` })
      },
      handleRevoke: async (invocation, ctx) => {
        const { role, who } = invocation.args
        if (role === undefined || who === undefined) {
          await ctx.reply({ text: 'usage: revoke <role> <who>' })
          return
        }
        const identity = await ctx.rhiza<PrincipalsRead>('mycelium').findByIdentity(invocation.message.channel, who)
        if (identity === null) {
          await ctx.reply({ text: `no identity '${who}' on channel '${invocation.message.channel}'` })
          return
        }
        try {
          await ctx.rhiza<RolesAssign>('mycelium').revokeRole(identity.id, role)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: `revoked '${role}' from ${who}` })
      },
      // Only `name` is a declared arg spec, so bindArgs binds the whole remainder to it;
      // the patterns after the name are parsed from invocation.rest instead.
      handleRoleNew: async (invocation, ctx) => {
        const rest = invocation.rest.trim()
        const space = rest.indexOf(' ')
        const name = space === -1 ? rest : rest.slice(0, space)
        const patterns = space === -1 ? [] : rest.slice(space + 1).trim().split(/\s+/).filter((p) => p !== '')
        if (name === '') {
          await ctx.reply({ text: 'usage: role-new <name> [pattern...]' })
          return
        }
        try {
          await ctx.rhiza<RolesManage>('mycelium').createRole(name, patterns)
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
          return
        }
        await ctx.reply({ text: `created role '${name}' with patterns: ${patterns.join(', ') || 'none'}` })
      },
      handlePluginList: async (_invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsRead>('mycelium')
        const lines = mycelium.listPlugins().map((p) => `${p.name} (${p.kind ?? 'unknown'}) — ${p.state}`)
        await ctx.reply({ text: lines.length === 0 ? 'no plugins' : lines.join('\n') })
      },
      handlePluginEnable: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsToggle>('mycelium')
        // The refusal reason is what tells the operator what to fix; swallowing it
        // would leave nothing but "failed".
        try {
          await mycelium.enable(invocation.args['name'] ?? '')
          await ctx.reply({ text: `enabled ${invocation.args['name'] ?? ''}` })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginDisable: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsToggle>('mycelium')
        try {
          await mycelium.disable(invocation.args['name'] ?? '')
          await ctx.reply({ text: `disabled ${invocation.args['name'] ?? ''}` })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginSet: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsConfigure>('mycelium')
        const { name, key, value } = invocation.args
        try {
          await mycelium.setSetting(name ?? '', key ?? '', coerce(value ?? ''))
          await ctx.reply({ text: `set ${key ?? ''} on ${name ?? ''}` })
        } catch (e) {
          await ctx.reply({ text: (e as Error).message })
        }
      },
      handlePluginConfig: async (invocation, ctx) => {
        const mycelium = ctx.rhiza<PluginsConfigure>('mycelium')
        const settings = await mycelium.settings(invocation.args['name'] ?? '')
        const entries = Object.entries(settings)
        await ctx.reply({
          text: entries.length === 0 ? 'no settings' : entries.map(([k, v]) => `${k} = ${String(v)}`).join('\n'),
        })
      },
    },
  }),
} satisfies EnzymeModule
