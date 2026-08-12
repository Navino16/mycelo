import type { ChannelCapability } from './capabilities.js'

/**
 * A rhiza is germinated but its upstream system cannot be reached. Transient by
 * definition: the plugin stays loaded and health() degrades (spec §8).
 */
export class RhizaUnreachableError extends Error {
  readonly rhiza: string
  constructor(rhiza: string, cause?: unknown) {
    super(`rhiza '${rhiza}' is unreachable`, cause === undefined ? undefined : { cause })
    this.name = 'RhizaUnreachableError'
    this.rhiza = rhiza
  }
}

/**
 * Thrown by send() when the target channel cannot do what the content requires.
 * The enzyme is expected to check ctx.capabilities first and adapt (spec §3.2).
 */
export class CapabilityMissingError extends Error {
  readonly channel: string
  readonly capability: ChannelCapability
  constructor(channel: string, capability: ChannelCapability) {
    super(`channel '${channel}' does not support '${capability}'`)
    this.name = 'CapabilityMissingError'
    this.channel = channel
    this.capability = capability
  }
}
