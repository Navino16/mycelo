import type { SporeKind } from './api/types.ts'
import type { Translate } from './i18n.tsx'
import type { StringKey } from '../locales/en.ts'

/**
 * Brief §6's vocabulary, in one spelling: `Rhizae · connected systems`. Never the wire value,
 * which is the lowercase singular and is in no catalogue.
 */
export function kindLabel(t: Translate, kind: SporeKind | 'unknown'): string {
  return `${t(`kind.${kind}` as StringKey)} · ${t(`kind.${kind}.subtitle` as StringKey)}`
}

/** 1c's trail, one shape for the plugin's two screens. The kind crumb goes when it is unknown. */
export function pluginTrail(
  t: Translate, name: string, kind: SporeKind | undefined,
): readonly { label: string, to?: string }[] {
  return [
    { label: t('plugins.title'), to: '/plugins' },
    ...(kind === undefined ? [] : [{ label: kindLabel(t, kind) }]),
    { label: name },
  ]
}
