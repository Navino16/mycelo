import { CycleError } from '../germination/anastomoses.js'
import { CollisionError } from '../germination/registry.js'
import { describeThrown } from '../support/thrown.js'
import type { Mycelium } from './start.js'
import type { Bootstrap } from '../config.js'
import type { Db } from '../persistence/db.js'
import type { Translator } from '../i18n/translator.js'

/** Discriminated on `kind` so a UI narrows to the fields its diagnosis screen needs. */
export type GerminationFailure =
  | { kind: 'cycle', message: string, spores: readonly string[] }
  | { kind: 'collision', message: string, command: string, plugins: readonly string[] }
  | { kind: 'unknown', message: string }

export type Germination =
  | { status: 'starting' }
  | { status: 'germinated', mycelium: Mycelium }
  | { status: 'degraded', failure: GerminationFailure }

/**
 * instanceof is sound here: both classes are the core's own, never a plugin's. The
 * `unknown` branch is a bug when it appears, and is reported rather than hidden.
 */
export function classifyGerminationFailure(e: unknown): GerminationFailure {
  if (e instanceof CycleError) return { kind: 'cycle', message: e.message, spores: e.cycle }
  if (e instanceof CollisionError) {
    return { kind: 'collision', message: e.message, command: e.command, plugins: e.plugins }
  }
  return { kind: 'unknown', message: describeThrown(e) }
}

export interface RuntimeState {
  readonly config: Bootstrap
  readonly db: Db
  /** When serve() built this state. One per boot, unlike a module-load constant. */
  readonly startedAt: Date
  /**
   * Survives every germination retry, unlike the admission chain that reads it: a fresh
   * chain is built each retry, so the count itself must live outside it (design §7).
   */
  readonly refusals: { blocked: number }
  /** Replaced by phase 2 once spore catalogues load; core-only until then (spec §3). */
  translator: Translator
  germination: Germination
  /** The in-flight retry, so two callers join one germination rather than racing. */
  retrying?: Promise<Germination>
}

export function createRuntimeState(
  config: Bootstrap, db: Db, translator: Translator,
): RuntimeState {
  return {
    config, db, startedAt: new Date(), refusals: { blocked: 0 }, translator,
    germination: { status: 'starting' },
  }
}
