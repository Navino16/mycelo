import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { HealthContext } from '../../src/health.tsx'
import { TONE_CLASSES } from '../../src/components/tone.ts'
import { I18nProvider } from '../../src/i18n.tsx'
import { HealthPill, healthPillState } from '../../src/shell/HealthPill.tsx'
import type { RuntimeHealth } from '../../src/api/types.ts'

const OK: RuntimeHealth = {
  mode: 'germinated', dormant: [], enforcingBlocked: [], rhizas: [], hyphae: [], blockedSinceBoot: 0,
}

function pill(health: RuntimeHealth | null, error = false, plugins?: number): void {
  render(
    <I18nProvider>
      <HealthContext value={{ health, error, refresh: () => Promise.resolve() }}>
        <HealthPill plugins={plugins} />
      </HealthContext>
    </I18nProvider>,
  )
}

describe('healthPillState', () => {
  it('is healthy only when nothing is dormant, blocked or unhealthy', () => {
    expect(healthPillState(OK, false).state).toBe('healthy')
  })

  // design note 2j: mute is the one red condition, so nothing else may produce it.
  it('is mute for a blocked enforcing inhibitor and for nothing else', () => {
    expect(healthPillState({ ...OK, enforcingBlocked: ['gate'] }, false).state).toBe('mute')
    expect(healthPillState({ ...OK, dormant: [{ name: 'radarr', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }] }, false).state).toBe('degraded')
    expect(healthPillState({ ...OK, mode: 'degraded' }, false).state).toBe('degraded')
    expect(healthPillState(OK, true).state).toBe('offline')
  })

  // CriticalBanner has four branches, not three, and this project's rule is that the
  // metaphor never replaces information: a failed poll and a malformed payload are two facts.
  it('keeps a failed poll and an unreadable payload apart', () => {
    expect(healthPillState(OK, true).state).toBe('offline')
    expect(healthPillState({ ...OK, enforcingBlocked: undefined as unknown as string[] }, false).state)
      .toBe('unreadable')
  })

  // Discriminates Array.isArray from a bare truthiness check: a truthy non-array is the trap.
  it('is unreadable, never healthy, when enforcingBlocked is not an array', () => {
    expect(healthPillState({ ...OK, enforcingBlocked: { oops: true } as unknown as string[] }, false).state)
      .toBe('unreadable')
    expect(healthPillState({ ...OK, dormant: undefined as unknown as [] }, false).state).toBe('unreadable')
    expect(healthPillState({ ...OK, rhizas: undefined as unknown as [] }, false).state).toBe('unreadable')
  })

  it('counts dormant plugins and unhealthy rhizas together, not one of the two', () => {
    const { issues } = healthPillState({
      ...OK,
      dormant: [{ name: 'a', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }, { name: 'b', reason: 'y', reasonKey: 'refusal.startup.startFailed' }],
      rhizas: [
        { rhiza: 'ok', status: { state: 'healthy', checkedAt: '2026-01-01' } },
        { rhiza: 'down', status: { state: 'unreachable', checkedAt: '2026-01-01' } },
      ],
    }, false)

    expect(issues).toBe(3)
  })

  // 2j: a mute bot is usually also degraded, and mute outranks it — "none of it matters while
  // the bot is mute". It still carries the count, or task 16's takeover has nothing to recount from.
  it('stays mute when the bot is degraded too, and keeps the issue count', () => {
    const { state, issues } = healthPillState(
      { ...OK, mode: 'degraded', enforcingBlocked: ['gate'], dormant: [{ name: 'a', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }] }, false,
    )

    expect(state).toBe('mute')
    expect(issues).toBe(1)
  })
})

describe('the pill', () => {
  it('names the count when there is more than one issue', () => {
    pill({ ...OK, dormant: [{ name: 'a', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }, { name: 'b', reason: 'y', reasonKey: 'refusal.startup.startFailed' }] })

    expect(screen.getByText('Degraded · 2 issues')).toBeDefined()
  })

  // One issue through a plural sentence reads "1 issues"; the count is the commonest value.
  it('says one issue in the singular', () => {
    pill({ ...OK, dormant: [{ name: 'a', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }] })

    expect(screen.getByText('Degraded · 1 issue')).toBeDefined()
  })

  // 2j draws the mute pill as a solid crit fill with light ink, alone among the tones: every
  // other state is a tint, so a tinted mute pill would read as one warning among several.
  it('says Mute for a blocked enforcing inhibitor, and fills it solid crit', () => {
    pill({ ...OK, enforcingBlocked: ['gate'] })
    const status = screen.getByRole('status')

    expect(status.getAttribute('data-tone')).toBe('crit')
    expect(screen.getByText('Mute')).toBeDefined()
    expect(status.className).toContain(TONE_CLASSES.crit.fill)
    expect(status.className).toContain('text-white')
    expect(status.className).not.toContain(TONE_CLASSES.crit.bg)
  })

  it('keeps every other state a tint, not a fill', () => {
    pill({ ...OK, dormant: [{ name: 'a', reason: 'x', reasonKey: 'refusal.germination.createNotObject' }] })
    const status = screen.getByRole('status')

    expect(status.className).toContain(TONE_CLASSES.warn.bg)
    expect(status.className).not.toContain('text-white')
  })

  // design note 2j: red is the mute bot's alone, so a failed poll is amber, not red.
  it('does not paint an unreachable substrate red', () => {
    pill(null, true)

    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warn')
    expect(screen.getByText('Not answering')).toBeDefined()
  })

  it('renders nothing at all before the first poll answers', () => {
    pill(null)

    expect(screen.queryByRole('status')).toBeNull()
  })

  // ruling F16: a substrate with no plugins has nothing to be healthy about — the core's own
  // boot log calls it a bot that can never answer. No fourth pill vocabulary: it renders nothing.
  it('says nothing rather than Healthy on a substrate with no plugins', () => {
    pill(OK, false, 0)

    expect(screen.queryByRole('status')).toBeNull()
  })

  // Only the healthy claim is suppressed: an empty substrate whose API stopped answering is
  // still a fact the operator needs, and the plugin count is unknown then anyway.
  it('still reports a substrate that is not answering, empty or not', () => {
    pill(null, true, 0)

    expect(screen.getByText('Not answering')).toBeDefined()
  })

  it('keeps the healthy pill for a substrate whose plugin count is merely unknown', () => {
    pill(OK, false, undefined)

    expect(screen.getByText('Healthy')).toBeDefined()
  })
})

// The pill's presence on every screen is now PageHeader's job (Layout renders no chrome, 1a-R4),
// and components/page-header.test.tsx pins both that and the counts.plugins wiring end to end.
