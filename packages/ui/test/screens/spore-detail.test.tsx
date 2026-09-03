import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { SporeDetail } from '../../src/screens/SporeDetail.tsx'
import type {
  CommandGroups, InoculateOutcome, PluginDto, PluginGroups, SourceDto, SporeStrainsDto,
} from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** The 2b spore, with the artboard's scope set corrected to real names (principals.read). */
const WELCOME: SporeStrainsDto = {
  strains: ['1.3.0', '1.2.0', '1.1.0'],
  detail: {
    name: 'enzyme-welcome',
    kind: 'enzyme',
    description: 'Greets a new sender and gives them a starting role',
    septum: '^0.11',
    demands: {
      requires: [
        { targets: ['hypha-signal', 'hypha-discord'], anyOf: true, optional: false, scopes: [] },
        { targets: ['rhiza-plex'], anyOf: false, optional: false, scopes: [] },
        { targets: ['rhiza-radarr'], anyOf: false, optional: true, scopes: [] },
      ],
      scopes: ['principals.read', 'roles.assign', 'messages.send', 'health.read'],
      externals: [],
      commands: [
        { name: 'welcome.test', capabilities: [] },
        { name: 'welcome.stats', capabilities: [] },
      ],
    },
  },
}

/** The control: a spore asking for read-only scopes only. */
const HARMLESS: SporeStrainsDto = {
  strains: ['1.0.0'],
  detail: {
    name: 'enzyme-status',
    kind: 'enzyme',
    description: 'Reports the substrate health',
    septum: '^0.11',
    demands: {
      requires: [],
      scopes: ['health.read', 'messages.send'],
      externals: [],
      commands: [{ name: 'status.show', capabilities: [] }],
    },
  },
}

/** One scope, which is the common case a plural-only string gets wrong. */
const ONE_SCOPE: SporeStrainsDto = {
  strains: ['1.0.0'],
  detail: {
    name: 'enzyme-ping',
    kind: 'enzyme',
    description: 'Answers ping',
    septum: '^0.11',
    demands: {
      requires: [],
      scopes: ['messages.send'],
      externals: [],
      commands: [{ name: 'ping', capabilities: [] }],
    },
  },
}

const OFFICIAL: SourceDto = {
  id: 1, label: 'Official registry', driver: 'github', location: 'https://github.com/x/y', official: true, enabled: true,
}
const THIRD_PARTY: SourceDto = {
  id: 2, label: 'My mirror', driver: 'github', location: 'https://github.com/a/b', official: false, enabled: true,
}

function plugin(name: string, extra: Partial<PluginDto> = {}): PluginDto {
  return { name, commands: [], state: 'germinated', enabled: true, ...extra }
}

const INSTALLED: PluginGroups = {
  hypha: [plugin('hypha-signal', { kind: 'hypha' }), plugin('hypha-discord', { kind: 'hypha' })],
  rhiza: [plugin('rhiza-radarr', { kind: 'rhiza', strain: '1.8.4' })],
  enzyme: [],
  inhibitor: [],
  unknown: [],
}

/**
 * `command` is the alias-resolved name germination keys its route table by, `declared` the
 * manifest's own; registry.ts:101 collides on the former (task 18 review finding 2).
 */
function command(plugin: string, declared: string, alias?: string): CommandGroups[string][number] {
  return {
    plugin,
    command: alias ?? declared,
    declared,
    qualified: `${plugin}.${declared}`,
    description: '',
    capabilities: [],
  }
}

const NO_COLLISION: CommandGroups = {
  'enzyme-other': [command('enzyme-other', 'films.search'), command('enzyme-other', 'films.add')],
  'enzyme-third': [command('enzyme-third', 'calendar.show')],
}
const COLLIDING: CommandGroups = {
  'enzyme-other': [command('enzyme-other', 'welcome.test'), command('enzyme-other', 'films.add')],
}
/** Renamed INTO the offer's name: the alias is what the runtime would refuse. */
const COLLIDING_BY_ALIAS: CommandGroups = {
  'enzyme-other': [command('enzyme-other', 'films.search', 'welcome.test')],
}
/** Renamed AWAY from it: the old declared name is free, so nothing collides. */
const FREED_BY_ALIAS: CommandGroups = {
  'enzyme-other': [command('enzyme-other', 'welcome.test', 'films.renamed')],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Options {
  spore?: SporeStrainsDto
  source?: SourceDto
  plugins?: PluginGroups
  commands?: CommandGroups
  strainsFail?: boolean
  sourceFail?: boolean
  pluginsFail?: boolean
  commandsFail?: boolean
}

interface Call { method: string, url: string, body: unknown }

function serve(opts: Options = {}): { calls: Call[] } {
  const calls: Call[] = []
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const refused = json({ error: { message: 'x' } }, 500)
    if (url === '/api/plugins') {
      return Promise.resolve(opts.pluginsFail === true ? refused : json(opts.plugins ?? INSTALLED))
    }
    if (url === '/api/commands') {
      return Promise.resolve(opts.commandsFail === true ? refused : json(opts.commands ?? NO_COLLISION))
    }
    if (/\/spores\//.test(url)) {
      return Promise.resolve(opts.strainsFail === true ? refused : json(opts.spore ?? WELCOME))
    }
    if (method === 'POST') return Promise.resolve(json({ error: { message: 'unexpected POST' } }, 400))
    return Promise.resolve(opts.sourceFail === true ? refused : json(opts.source ?? THIRD_PARTY))
  }) as unknown as typeof fetch
  return { calls }
}

function renderDetail(spore = 'enzyme-welcome'): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/sources/2/spores/${spore}`]}>
        <Routes><Route path="/sources/:id/spores/:name" element={<SporeDetail />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('the spore detail screen', () => {
  it('says something went wrong when both fetches fail, rather than staying blank', async () => {
    serve({ strainsFail: true, sourceFail: true })
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  // The alert is the union of two independent flags; a mutant collapsing it to one flag alone
  // must be caught from each side.
  it('says something went wrong when only the source fetch fails', async () => {
    serve({ sourceFail: true })
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('says something went wrong when only the strains fetch fails', async () => {
    serve({ strainsFail: true })
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  // The two joins are decoration on this screen: refusing them must cost the columns they
  // feed, never the consent moment itself.
  it('still renders the consent moment when the plugin and command joins are refused', async () => {
    serve({ pluginsFail: true, commandsFail: true })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('enzyme-welcome')).toBeDefined() })
    expect(screen.getByTestId('consent')).toBeDefined()
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })

  // Finding 1: `undefined` from the join's map is "known and not installed"; a refused join
  // knows nothing, and must not claim it either on the chip or anywhere else.
  it('claims nothing about the install state when the plugin join is refused', async () => {
    serve({ pluginsFail: true })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('enzyme-welcome')).toBeDefined() })
    expect(screen.queryByTestId('install-state')).toBeNull()
    expect(screen.queryByText('not installed')).toBeNull()
    expect(screen.getByRole('button', { name: 'Inoculate and grant 4 scopes' })).toBeDefined()
  })

  it('renders the spore on success, with no error banner', async () => {
    serve()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('enzyme-welcome')).toBeDefined() })
    expect(screen.getByText('Greets a new sender and gives them a starting role')).toBeDefined()
    expect(screen.getByText('Wants plugin contract ^0.11')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leads with the trail back to the source and its kind', async () => {
    serve()
    renderDetail()

    const trail = await screen.findByRole('navigation', { name: 'breadcrumb' })
    expect(trail.textContent).toContain('Sources')
    expect(trail.textContent).toContain('My mirror')
    expect(trail.textContent).toContain('Enzymes')
  })

  it('chips the install state, the newest strain and the command count', async () => {
    serve()
    renderDetail()

    await waitFor(() => { expect(screen.getByTestId('install-state')).toBeDefined() })
    expect(screen.getByTestId('install-state').textContent).toBe('not installed')
    expect(screen.getByText('strain 1.3.0')).toBeDefined()
    expect(screen.getByText('2 commands')).toBeDefined()
  })

  it('chips it as installed once it is, rather than always offering a first install', async () => {
    serve({
      plugins: { ...INSTALLED, enzyme: [plugin('enzyme-welcome', { kind: 'enzyme', strain: '1.3.0' })] },
    })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('enzyme-welcome')).toBeDefined() })
    expect(screen.getByTestId('install-state').textContent).toBe('installed')
  })
})

// brief §7B. A screen that alerts on every plugin has said nothing, so both halves are here.
describe('the consent moment', () => {
  it('raises the amber alert and names the rights-widening scope', async () => {
    serve()
    renderDetail()

    const consent = await screen.findByTestId('consent')
    expect(consent.textContent).toContain('This plugin can change who may run what')
    expect(consent.textContent).toContain('roles.assign')
    expect(consent.textContent).toContain('Assign roles to people')
  })

  it('raises no alert at all for a spore asking only for read-only scopes', async () => {
    serve({ spore: HARMLESS })
    renderDetail('enzyme-status')

    await waitFor(() => { expect(screen.getByText('enzyme-status')).toBeDefined() })
    expect(screen.queryByTestId('consent')).toBeNull()
    // The table still renders: it is the alert that is conditional, not the disclosure.
    expect(screen.getByTestId('scope-table')).toBeDefined()
  })

  it('names only the high-risk scopes in the alert, not every scope it asks for', async () => {
    serve()
    renderDetail()

    const consent = await screen.findByTestId('consent')
    expect(consent.textContent).not.toContain('health.read')
    expect(consent.textContent).not.toContain('messages.send')
  })

  it('lists every requested scope with its id, its sentence and its grade as a word', async () => {
    serve()
    renderDetail()

    const table = await screen.findByTestId('scope-table')
    expect(within(table).getAllByRole('listitem')).toHaveLength(4)

    const assign = table.querySelector('[data-scope="roles.assign"]')
    expect(assign?.getAttribute('data-risk')).toBe('high')
    expect(assign?.textContent).toContain('roles.assign')
    expect(assign?.textContent).toContain('Assign roles to people')
    expect(assign?.textContent).toContain('high')

    const read = table.querySelector('[data-scope="health.read"]')
    expect(read?.getAttribute('data-risk')).toBe('low')
    expect(read?.textContent).toContain('low')

    // R7 keeps the word AND the colour: the literals, because an assertion reading
    // TONE_CLASSES moves with the table and cannot see the grade lose its amber.
    expect(assign?.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-warn')
    expect(read?.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-idle')
  })

  it('says the scopes are granted as one block at install, and how many', async () => {
    serve()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Requested scopes · 4')).toBeDefined() })
    expect(screen.getByText('granted as a block at install')).toBeDefined()
  })
})

describe('what installing will bring in', () => {
  it('resolves each requirement against what is installed', async () => {
    serve()
    renderDetail()

    await waitFor(() => { expect(screen.getByTestId('requirements')).toBeDefined() })
    const rows = screen.getByTestId('requirements')

    const anyOf = rows.querySelector('[data-requirement="hypha-signal|hypha-discord"]')
    expect(anyOf?.textContent).toContain('one of')
    expect(anyOf?.textContent).toContain('2 installed')

    const missing = rows.querySelector('[data-requirement="rhiza-plex"]')
    expect(missing?.textContent).toContain('not installed')

    const optional = rows.querySelector('[data-requirement="rhiza-radarr"]')
    expect(optional?.textContent).toContain('optional')
    expect(optional?.textContent).toContain('1.8.4')
  })

  it('names the commands it will add and says nothing collides', async () => {
    serve()
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Commands it will add')).toBeDefined() })
    expect(screen.getByText('welcome.test')).toBeDefined()
    expect(screen.getByText('welcome.stats')).toBeDefined()
    expect(screen.getByText('No collision with the 3 commands already installed.')).toBeDefined()
  })

  // The discriminating half: a screen that always says "no collision" is worse than silent.
  it('names the colliding command when one is already installed', async () => {
    serve({ commands: COLLIDING })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Commands it will add')).toBeDefined() })
    expect(screen.getByText('Collides with an installed command: welcome.test')).toBeDefined()
    expect(screen.queryByText(/No collision/)).toBeNull()
  })

  // Finding 2: germination keys its route table by the alias-resolved name
  // (registry.ts:101), so a check against `declared` is both stricter and more lenient than
  // the runtime — broken either way (CLAUDE.md).
  it('collides with a command renamed into the offer name, not with its old declared name', async () => {
    serve({ commands: COLLIDING_BY_ALIAS })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Commands it will add')).toBeDefined() })
    expect(screen.getByText('Collides with an installed command: welcome.test')).toBeDefined()
  })

  it('sees no collision with a command renamed away from the offer name', async () => {
    serve({ commands: FREED_BY_ALIAS })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('Commands it will add')).toBeDefined() })
    expect(screen.getByText('No collision with the 1 command already installed.')).toBeDefined()
    expect(screen.queryByText(/Collides/)).toBeNull()
  })
})

describe('installing it', () => {
  it('names the grant on the button rather than saying only Install', async () => {
    serve()
    renderDetail()

    expect(await screen.findByRole('button', { name: 'Inoculate and grant 4 scopes' })).toBeDefined()
  })

  // A one-scope plugin is the common case, and 'grant 1 scopes' is what a plural-only key says.
  it('says one scope in the singular on the button', async () => {
    serve({ spore: ONE_SCOPE, commands: FREED_BY_ALIAS })
    renderDetail('enzyme-ping')

    expect(await screen.findByRole('button', { name: 'Inoculate and grant 1 scope' })).toBeDefined()
  })

  it('says installing is not starting, which is the two-act rule the SPA implements', async () => {
    serve()
    renderDetail()

    await waitFor(() => {
      expect(screen.getByText(
        'Installing does not start it. You configure it, then enable it as a separate act.',
      )).toBeDefined()
    })
  })

  // The plugin trust model made visible (CLAUDE.md, user 2026-08-13): it appears in no
  // artboard, and it must sit above the button it qualifies.
  it('puts the trust notice above the install button for a third-party source', async () => {
    serve()
    renderDetail()

    const note = await screen.findByRole('note')
    const button = screen.getByRole('button', { name: 'Inoculate and grant 4 scopes' })
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0)
  })

  it('shows no trust warning for the official source', async () => {
    serve({ source: OFFICIAL })
    renderDetail()

    await waitFor(() => { expect(screen.getByText('enzyme-welcome')).toBeDefined() })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('installs the newest strain with no strain in the body', async () => {
    const { calls } = serve()
    renderDetail()
    const button = await screen.findByRole('button', { name: 'Inoculate and grant 4 scopes' })

    fireEvent.click(button)

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'enzyme-welcome' })
  })

  // SporeStrainsDto.strains was fetched and thrown away before this task.
  it('offers the older strains in a sheet and installs the chosen one', async () => {
    const { calls } = serve()
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Other strains' }))

    const sheet = screen.getByRole('dialog', { name: 'Other strains' })
    expect(within(sheet).getByRole('button', { name: '1.2.0' })).toBeDefined()
    expect(within(sheet).getByRole('button', { name: '1.1.0' })).toBeDefined()
    fireEvent.click(within(sheet).getByRole('button', { name: '1.1.0' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'enzyme-welcome', strain: '1.1.0',
    })
  })

  // phase 8B measured a mutant that dropped every warning but the first: assert both.
  it('renders every warning the install returns, not just the first', async () => {
    serve()
    renderDetail()
    const button = await screen.findByRole('button', { name: 'Inoculate and grant 4 scopes' })

    const outcome: InoculateOutcome = {
      name: 'enzyme-welcome',
      strain: '1.3.0',
      warnings: [
        'this is not the official sporangium: its spores are not code-reviewed',
        'a restart is required for this to take effect',
      ],
      restartRequired: true,
    }
    globalThis.fetch = mock(() => Promise.resolve(json(outcome)))
    fireEvent.click(button)

    await waitFor(() => { expect(screen.getByText('Installed as 1.3.0')).toBeDefined() })
    expect(screen.getByText('this is not the official sporangium: its spores are not code-reviewed')).toBeDefined()
    expect(screen.getByText('a restart is required for this to take effect')).toBeDefined()
  })

  it('shows the server refusal in its own alert when the install itself is refused', async () => {
    serve()
    renderDetail()
    const button = await screen.findByRole('button', { name: 'Inoculate and grant 4 scopes' })

    globalThis.fetch = mock(() => Promise.resolve(
      json({ error: { message: "'enzyme-welcome' is already installed" } }, 400),
    ))
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("'enzyme-welcome' is already installed")
  })
})
