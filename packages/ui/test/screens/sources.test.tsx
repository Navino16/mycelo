import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { Sources } from '../../src/screens/Sources.tsx'
import type { SourceDto, SporeOffer } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const OFFICIAL: SourceDto = {
  id: 1,
  label: 'sporangium/core',
  driver: 'github',
  location: 'git@git.mycelo.dev:core.git',
  official: true,
  enabled: true,
}
const THIRD_PARTY: SourceDto = {
  id: 2,
  label: 'sporangium/community',
  driver: 'github',
  location: 'https://github.com/mycelo-community/spores.git',
  official: false,
  enabled: true,
  token: '••••',
}
const DISABLED: SourceDto = {
  id: 3, label: 'Old one', driver: 'github', location: 'https://github.com/c/d', official: false, enabled: false,
}

function offers(count: number): SporeOffer[] {
  return Array.from({ length: count }, (_, i) => ({ name: `spore-${String(i + 1)}`, strain: '1.0.0' }))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }

interface Options {
  /** Spore counts per source id; a missing id makes that source's listing refuse. */
  catalogues?: Record<number, number>
  patchRefusal?: string
}

/**
 * A stateful fake serving the routes Sources.tsx calls, tracking every call it saw. A source
 * with no catalogue entry answers 400, which is how an unreachable one behaves.
 */
function mockApi(initial: readonly SourceDto[], opts: Options = {}): { calls: Call[] } {
  const calls: Call[] = []
  let list = [...initial]
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/sources') return Promise.resolve(json(list))

    const spores = /^\/api\/sources\/(\d+)\/spores$/.exec(url)
    if (method === 'GET' && spores !== null) {
      const count = opts.catalogues?.[Number(spores[1])]
      return Promise.resolve(count === undefined
        ? json({ error: { message: 'could not be read' } }, 400)
        : json(offers(count)))
    }

    if (method === 'POST' && url === '/api/sources') {
      const created = { id: list.length + 1, driver: 'github', official: false, enabled: true, ...body as object }
      list = [...list, created as SourceDto]
      return Promise.resolve(json(created))
    }

    const patch = /^\/api\/sources\/(\d+)$/.exec(url)
    if (method === 'PATCH' && patch !== null) {
      if (opts.patchRefusal !== undefined) {
        return Promise.resolve(json({ error: { message: opts.patchRefusal } }, 409))
      }
      const id = Number(patch[1])
      list = list.map((s) => (s.id === id ? { ...s, ...body as object } : s))
      const saved = list.find((s) => s.id === id)
      // toDto (routes/sources.ts) never echoes a stored token back, only the mask.
      return Promise.resolve(json(
        saved === undefined ? undefined : { ...saved, ...(saved.token === undefined ? {} : { token: '••••' }) },
      ))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderSources(): void {
  render(<I18nProvider><MemoryRouter><Sources /></MemoryRouter></I18nProvider>)
}

async function openEdit(id: number): Promise<HTMLElement> {
  const row = await screen.findByTestId(`source-${String(id)}`)
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
  return screen.getByRole('dialog')
}

describe('the sources list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderSources()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the list on success, with no error banner', async () => {
    mockApi([OFFICIAL], { catalogues: { 1: 61 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('sporangium/core')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The contrast is the point: an official source and a third-party one must read differently.
  it('badges the official source and a third-party one differently', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61, 2: 112 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('sporangium/core')).toBeDefined() })
    expect(within(screen.getByTestId('source-1')).getByText('Official')).toBeDefined()
    expect(within(screen.getByTestId('source-2')).getByText('Third-party')).toBeDefined()
  })

  it('badges a disabled source as disabled rather than by its trust level', async () => {
    mockApi([DISABLED], { catalogues: { 3: 0 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('Old one')).toBeDefined() })
    expect(within(screen.getByTestId('source-3')).getByText('Disabled')).toBeDefined()
    expect(within(screen.getByTestId('source-3')).queryByText('Third-party')).toBeNull()
  })

  it('shows each source git url, which is what tells two mirrors apart', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61, 2: 112 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('git@git.mycelo.dev:core.git')).toBeDefined() })
    expect(screen.getByText('https://github.com/mycelo-community/spores.git')).toBeDefined()
  })

  it('counts the catalogue of each source and totals them in the header', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61, 2: 112 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('2 registries · 173 spores visible')).toBeDefined() })
    expect(within(screen.getByTestId('source-1')).getByText('61 spores')).toBeDefined()
    expect(within(screen.getByTestId('source-2')).getByText('112 spores')).toBeDefined()
  })

  // The counts are fired after the list renders, never as a gate on it: one unreachable
  // source blanking the whole page is the failure this ordering exists to prevent.
  it('keeps every row when one source cannot answer for its catalogue', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61 } })
    renderSources()

    await waitFor(() => { expect(within(screen.getByTestId('source-1')).getByText('61 spores')).toBeDefined() })
    expect(screen.getByTestId('source-2')).toBeDefined()
    expect(within(screen.getByTestId('source-2')).queryByText(/\d+ spores/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The summary is withheld, never under-summed: `2 registries · 61 spores visible` while
    // one source has not answered is a wrong number with no marker on it.
    expect(screen.queryByText(/registries · \d+ spores visible/)).toBeNull()
  })

  // Discriminates withholding from never rendering: the same table with every count in
  // prints the sum.
  it('sums the catalogue only once every source has answered', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61, 2: 4 } })
    renderSources()

    expect(await screen.findByText('2 registries · 65 spores visible')).toBeDefined()
  })

  // The standing singular ruling: '1 registries · 1 spores' is what a plural-only key says.
  it('counts one registry and one spore in the singular', async () => {
    mockApi([OFFICIAL], { catalogues: { 1: 1 } })
    renderSources()

    await waitFor(() => { expect(screen.getByText('1 registry · 1 spores visible')).toBeDefined() })
    expect(within(screen.getByTestId('source-1')).getByText('1 spore')).toBeDefined()
  })

  it('says what an unreachable source does and does not block', async () => {
    mockApi([OFFICIAL], { catalogues: { 1: 61 } })
    renderSources()

    await waitFor(() => {
      expect(screen.getByText(
        'An unreachable source blocks installing and strain updates only. Nothing that is already germinated is affected.',
      )).toBeDefined()
    })
  })
})

describe('adding a source', () => {
  it('keeps the form behind a sheet rather than sitting open under the list', async () => {
    mockApi([OFFICIAL], { catalogues: { 1: 61 } })
    renderSources()
    await waitFor(() => { expect(screen.getByText('sporangium/core')).toBeDefined() })

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    expect(screen.getByRole('dialog', { name: 'Add a source' })).toBeDefined()
  })

  it('adds a source with the fixed github driver and the typed fields', async () => {
    const { calls } = mockApi([])
    renderSources()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add a source' })).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Mirror' } })
    fireEvent.change(within(sheet).getByLabelText('Location'), { target: { value: 'https://github.com/a/b' } })
    fireEvent.change(within(sheet).getByLabelText(/Token/), { target: { value: 'a-token' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Mirror', driver: 'github', location: 'https://github.com/a/b', token: 'a-token',
    })
  })

  it('omits the token from the add request when none was typed', async () => {
    const { calls } = mockApi([])
    renderSources()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add a source' })).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Mirror' } })
    fireEvent.change(within(sheet).getByLabelText('Location'), { target: { value: 'https://github.com/a/b' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'POST')).toBe(true) })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Mirror', driver: 'github', location: 'https://github.com/a/b',
    })
  })

  it('closes the sheet once the source is added', async () => {
    mockApi([])
    renderSources()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add a source' })).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))

    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Mirror' } })
    fireEvent.change(within(sheet).getByLabelText('Location'), { target: { value: 'https://github.com/a/b' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    // Waits on the reloaded row, not on the sheet's absence: a waitFor on the absence hangs
    // in this runner even once the sheet is gone (measured).
    await waitFor(() => { expect(screen.getByTestId('source-1')).toBeDefined() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('editing a source', () => {
  // The mask round trip: submitting untouched must not overwrite the stored credential, and
  // the chosen shape is sending the mask back verbatim — sources.ts skips a value equal to it.
  it('sends the stored mask back unchanged when the token field is left untouched', async () => {
    const { calls } = mockApi([THIRD_PARTY], { catalogues: { 2: 112 } })
    renderSources()
    const sheet = await openEdit(2)

    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ token: '••••' })
  })

  it('keeps the sentence that explains why the mask must be left alone', async () => {
    mockApi([THIRD_PARTY], { catalogues: { 2: 112 } })
    renderSources()
    const sheet = await openEdit(2)

    expect(within(sheet).getByText('Leave as •••• to keep the stored token.')).toBeDefined()
  })

  it('sends the typed token when the field is changed', async () => {
    const { calls } = mockApi([THIRD_PARTY], { catalogues: { 2: 112 } })
    renderSources()
    const sheet = await openEdit(2)

    fireEvent.change(within(sheet).getByLabelText(/Token/), { target: { value: 'brand-new-token' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PATCH')).toBe(true) })
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ token: 'brand-new-token' })
  })

  // A typed PAT must not stay legible in the DOM, and must be re-synced to the mask the
  // PATCH answers with rather than echoing back what was typed.
  it('masks the token field and re-syncs it to the stored mask after saving', async () => {
    mockApi([THIRD_PARTY], { catalogues: { 2: 112 } })
    renderSources()
    const sheet = await openEdit(2)

    const tokenInput = within(sheet).getByLabelText(/Token/)
    fireEvent.change(tokenInput, { target: { value: 'brand-new-token' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect((tokenInput as HTMLInputElement).value).toBe('••••') })
    expect(tokenInput).toHaveProperty('type', 'password')
  })

  // api.sourceOfficialLocation: the core refuses to move the official registry, and the
  // refusal belongs beside the field that caused it, not on the page.
  it('renders the server refusal inside the sheet of the row that caused it', async () => {
    mockApi([OFFICIAL], {
      catalogues: { 1: 61 },
      patchRefusal: "the official sporangium's location cannot be changed",
    })
    renderSources()
    const sheet = await openEdit(1)

    fireEvent.change(within(sheet).getByLabelText('Location'), { target: { value: 'https://elsewhere/x.git' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    const alert = await within(sheet).findByRole('alert')
    expect(alert.textContent).toBe("the official sporangium's location cannot be changed")
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('opens each row own sheet, carrying that source values and no other', async () => {
    mockApi([OFFICIAL, THIRD_PARTY], { catalogues: { 1: 61, 2: 112 } })
    renderSources()
    const sheet = await openEdit(2)

    expect(within(sheet).getByLabelText('Name')).toHaveProperty('value', 'sporangium/community')
    expect(within(sheet).getByLabelText('Location'))
      .toHaveProperty('value', 'https://github.com/mycelo-community/spores.git')
  })
})
