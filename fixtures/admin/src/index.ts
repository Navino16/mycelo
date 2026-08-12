import type {
  EnzymeModule, PluginsRead, PrincipalsRead, RolesAssign, RolesManage, RolesRead,
} from '@mycelo/septum'

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
    },
  }),
} satisfies EnzymeModule
