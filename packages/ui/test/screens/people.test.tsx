import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { People } from '../../src/screens/People.tsx'
import type { PageDto, PersonDto, RoleDto } from '../../src/api/types.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const ROLES: readonly RoleDto[] = [
  { name: 'owner', builtin: true, patterns: ['*'] },
  { name: 'guest', builtin: false, patterns: ['help.help'] },
  { name: 'family', builtin: false, patterns: ['radarr.*'] },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * The design's own population: 128 people of whom 14 have never been reviewed. Three rows
 * cannot fail on a footer that computes `to` wrongly, which is what brief §3's "designed at
 * real scale" is about.
 */
function population(count = 128): PersonDto[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return {
      id: `person-${String(n)}`,
      displayName: `Person ${String(n)}`,
      roles: n % 9 === 0 ? ['guest'] : ['family', 'owner'],
      identities: n % 2 === 0
        ? [{ channel: 'signal', externalId: `+1555${String(n)}` }, { channel: 'discord', externalId: `d-${String(n)}` }]
        : [{ channel: 'signal', externalId: `+1555${String(n)}` }],
      reviewed: n % 9 !== 0,
    }
  })
}

interface Call { method: string, url: string, body: unknown }

/** A stateful fake serving what People.tsx calls, tracking every call it saw. */
function mockApi(options: {
  people?: readonly PersonDto[]
  roles?: readonly RoleDto[]
  postOutcomes?: Record<string, number>
  fail?: boolean
} = {}): { calls: Call[] } {
  const calls: Call[] = []
  let people = [...(options.people ?? population())]
  const roles = options.roles ?? ROLES

  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (options.fail === true) return Promise.resolve(json({ error: { message: 'x' } }, 500))

    if (method === 'GET' && url.startsWith('/api/people?')) {
      const params = new URLSearchParams(url.split('?')[1])
      const page = Number(params.get('page') ?? '1')
      const perPage = Number(params.get('perPage') ?? '25')
      const q = params.get('q')
      const role = params.get('role')
      let filtered: readonly PersonDto[] = people
      if (q !== null && q !== '') {
        const needle = q.toLowerCase()
        filtered = filtered.filter((p) => (p.displayName ?? '').toLowerCase().includes(needle))
      }
      if (params.get('reviewed') === 'false') filtered = filtered.filter((p) => !p.reviewed)
      if (role !== null) filtered = filtered.filter((p) => p.roles.includes(role))
      const start = (page - 1) * perPage
      const items = filtered.slice(start, start + perPage)
      return Promise.resolve(json({ items, page, perPage, total: filtered.length }))
    }

    if (method === 'GET' && url === '/api/roles') return Promise.resolve(json(roles))

    const post = /^\/api\/people\/([^/]+)\/roles$/.exec(url)
    if (method === 'POST' && post !== null) {
      const status = options.postOutcomes?.[post[1] as string] ?? 200
      if (status !== 200) return Promise.resolve(json({ error: { message: 'refused' } }, status))
      return Promise.resolve(json({ ok: true }))
    }

    const del = /^\/api\/people\/([^/]+)\/roles\/([^/]+)$/.exec(url)
    if (method === 'DELETE' && del !== null) return Promise.resolve(json({ ok: true }))

    const patch = /^\/api\/people\/([^/]+)$/.exec(url)
    if (method === 'PATCH' && patch !== null) {
      people = people.map((p) => (p.id === patch[1] ? { ...p, reviewed: true } : p))
      return Promise.resolve(json(people.find((p) => p.id === patch[1])))
    }

    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderPeople(): void {
  render(<I18nProvider><MemoryRouter><People /></MemoryRouter></I18nProvider>)
}

/** The row's own checkbox, whose label is the person's display name. */
function selectRow(name: string): void {
  fireEvent.click(screen.getByLabelText(name))
}

describe('the people list', () => {
  it('says something went wrong when the fetch fails, rather than staying blank', async () => {
    mockApi({ fail: true })
    renderPeople()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the first page and the known count, with no error banner', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    expect(screen.getByText('Person 25')).toBeDefined()
    expect(screen.queryByText('Person 26')).toBeNull()
    expect(screen.getByText('128 known')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Both columns are fetched by the old screen and rendered by nothing (§3 rows 17-18).
  it('renders each row’s identities and roles, which the payload has always carried', async () => {
    mockApi()
    renderPeople()

    const row = await screen.findByTestId('person-person-2')
    expect(within(row).getByText('signal · discord')).toBeDefined()
    expect(within(row).getByText('family, owner')).toBeDefined()
  })

  it('marks a never-reviewed row and leaves a reviewed one alone', async () => {
    mockApi()
    renderPeople()

    const never = await screen.findByTestId('person-person-9')
    expect(within(never).getByText('Never reviewed')).toBeDefined()
    expect(within(screen.getByTestId('person-person-1')).getByText('reviewed')).toBeDefined()
  })

  it('debounces the search box: rapid typing produces exactly one query request', async () => {
    const { calls } = mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    calls.length = 0

    const input = screen.getByLabelText('Search')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'al' } })
    fireEvent.change(input, { target: { value: 'ali' } })

    await act(() => new Promise((resolve) => setTimeout(resolve, 350)))

    const queried = calls.filter((c) => c.method === 'GET' && c.url.includes('q='))
    expect(queried).toHaveLength(1)
    expect(queried[0]?.url).toContain('q=ali')
  })

  it('offers the never-reviewed count as a chip, and filters on it when pressed', async () => {
    const { calls } = mockApi()
    renderPeople()

    const chip = await screen.findByRole('button', { name: /Never reviewed/ })
    await waitFor(() => { expect(chip.textContent).toBe('Never reviewed14') })
    expect(chip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip)

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('page=1') && c.url.includes('reviewed=false'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: /Never reviewed/ }).getAttribute('aria-pressed')).toBe('true')
  })

  // A count nobody confirmed is withheld, never rendered as 0 (task 19's ruling).
  it('withholds the never-reviewed count when that one request is refused', async () => {
    const calls: Call[] = []
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: undefined })
      if (url.includes('reviewed=false')) return Promise.resolve(json({ error: { message: 'x' } }, 500))
      if (url === '/api/roles') return Promise.resolve(json(ROLES))
      return Promise.resolve(json({ items: population().slice(0, 25), page: 1, perPage: 25, total: 128 }))
    }) as unknown as typeof fetch
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    expect(screen.getByRole('button', { name: /Never reviewed/ }).textContent).toBe('Never reviewed')
  })

  it('filters by role through the role chip, and returns to the first page doing it', async () => {
    const { calls } = mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => { expect(screen.getByText('Person 26')).toBeDefined() })
    calls.length = 0

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'guest' } })

    await waitFor(() => { expect(calls.some((c) => c.url.includes('role=guest')) ).toBe(true) })
    const filtered = calls.find((c) => c.url.includes('role=guest'))
    expect(filtered?.url).toContain('page=1')
    await waitFor(() => { expect(screen.getByText('14 known')).toBeDefined() })
  })

  it('offers an empty state, not a blank table, when the search matches nobody', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody at all' } })

    expect(await screen.findByText('Nobody matches that')).toBeDefined()
    expect(screen.queryByText('Person 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(await screen.findByText('Person 1')).toBeDefined()
  })
})

describe('the people list footer', () => {
  it('shows the first page as 1–25 of 128, with no way back', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByText('Showing 1–25 of 128')).toBeDefined()
    expect(screen.getByText('Page 1 / 6')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true)
  })

  // The discriminating case for `from`: a footer hardcoding 1, or computing page*perPage,
  // is green on page 1 and wrong here.
  it('shows the second page as 26–50 of 128', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Showing 26–50 of 128')).toBeDefined()
    expect(screen.getByText('Page 2 / 6')).toBeDefined()
  })

  // 128 is not a multiple of 25, so the last page holds three rows and `to` must be the total.
  it('stops the last page at the total, not at page × perPage', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      await waitFor(() => { expect(screen.getByText(`Page ${String(i + 2)} / 6`)).toBeDefined() })
    }

    expect(await screen.findByText('Showing 126–128 of 128')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true)
  })

  it('re-pages from the first row when the per-page size changes', async () => {
    const { calls } = mockApi()
    renderPeople()

    expect(await screen.findByText('Person 1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => { expect(screen.getByText('Person 26')).toBeDefined() })

    fireEvent.change(screen.getByLabelText('Per page'), { target: { value: '50' } })

    expect(await screen.findByText('Showing 1–50 of 128')).toBeDefined()
    const last = calls[calls.length - 1]
    expect(last?.url).toContain('perPage=50')
    expect(last?.url).toContain('page=1')
  })
})

describe('the people list in bulk', () => {
  async function selectThree(): Promise<void> {
    renderPeople()
    expect(await screen.findByText('Person 1')).toBeDefined()
    selectRow('Person 1')
    selectRow('Person 2')
    selectRow('Person 3')
    expect(screen.getByText('3 selected')).toBeDefined()
  }

  it('assigns a role and reports how many of how many succeeded, not a plain success', async () => {
    const { calls } = mockApi({ postOutcomes: { 'person-2': 500 } })
    await selectThree()

    fireEvent.change(screen.getByLabelText('Add role…'), { target: { value: 'guest' } })

    await waitFor(() => { expect(calls.filter((c) => c.method === 'POST').length).toBe(3) })
    expect(await screen.findByText(/2 of 3 assigned/)).toBeDefined()
  })

  it('removes a role from every selected person', async () => {
    const { calls } = mockApi()
    await selectThree()

    fireEvent.change(screen.getByLabelText('Remove role…'), { target: { value: 'family' } })

    await waitFor(() => { expect(calls.filter((c) => c.method === 'DELETE').length).toBe(3) })
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      '/api/people/person-1/roles/family',
      '/api/people/person-2/roles/family',
      '/api/people/person-3/roles/family',
    ])
    expect(await screen.findByText(/3 of 3 unassigned/)).toBeDefined()
  })

  it('marks every selected person reviewed, and only ever reviewed:true', async () => {
    const { calls } = mockApi()
    await selectThree()

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))

    await waitFor(() => { expect(calls.filter((c) => c.method === 'PATCH').length).toBe(3) })
    for (const call of calls.filter((c) => c.method === 'PATCH')) {
      expect(call.body).toEqual({ reviewed: true })
    }
    expect(await screen.findByText(/3 of 3 marked reviewed/)).toBeDefined()
  })

  it('clears the selection, and the bar with it', async () => {
    mockApi()
    await selectThree()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.queryByText('3 selected')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull()
  })

  it('selects every never-reviewed person at once, across pages', async () => {
    mockApi()
    renderPeople()

    const select = await screen.findByRole('button', { name: 'Select all 14 never-reviewed' })
    fireEvent.click(select)

    expect(await screen.findByText('14 selected')).toBeDefined()
  })

  // ruling F15: on an empty search the screen says nobody matches and still offered the bar;
  // one click armed Add role / Remove role / Mark reviewed over 121 invisible people.
  it('withdraws the select-all offer while the filtered list is empty', async () => {
    mockApi()
    renderPeople()

    expect(await screen.findByRole('button', { name: 'Select all 14 never-reviewed' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody at all' } })

    expect(await screen.findByText('Nobody matches that')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull()
  })

  it('disarms a live selection\u2019s actions while the filtered list is empty', async () => {
    mockApi()
    await selectThree()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody at all' } })

    expect(await screen.findByText('Nobody matches that')).toBeDefined()
    expect(screen.queryByText('3 selected')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull()
    expect(screen.queryByLabelText('Add role\u2026')).toBeNull()
  })

  // Discriminates the singular selection: 'Select all 1 never-reviewed' would read wrong and
  // is not what the catalogue holds.
  it('names the one never-reviewed person in the singular', async () => {
    const people = population().map((p, i) => ({ ...p, reviewed: i !== 0 }))
    mockApi({ people })
    renderPeople()

    expect(await screen.findByRole('button', { name: 'Select the one never-reviewed person' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull()
  })
})

describe('the people list against an out-of-order response', () => {
  /** A fetch mock whose promises are resolved by the test, in whatever order it chooses. */
  function deferredMock(): { calls: Call[], respond: (matches: (url: string) => boolean, body: unknown) => void } {
    const calls: Call[] = []
    const pending: { url: string, resolve: (r: Response) => void }[] = []
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: undefined })
      return new Promise<Response>((resolve) => { pending.push({ url, resolve }) })
    }) as unknown as typeof fetch
    function respond(matches: (url: string) => boolean, body: unknown): void {
      const index = pending.findIndex((p) => matches(p.url))
      if (index === -1) throw new Error(`no pending request matches; saw ${JSON.stringify(pending.map((p) => p.url))}`)
      const [entry] = pending.splice(index, 1)
      entry?.resolve(json(body))
    }
    return { calls, respond }
  }

  function pageBody(page: number, name: string): PageDto<PersonDto> {
    return { items: [{ id: name, displayName: name, roles: [], identities: [], reviewed: false }], page, perPage: 25, total: 150 }
  }

  /** The list request for a page, told apart from the never-reviewed count by its page param. */
  function isList(page: number): (url: string) => boolean {
    return (url) => url.includes(`page=${String(page)}&`) && !url.includes('reviewed=false')
  }

  it('shows the last-requested page, not whichever response happens to arrive last', async () => {
    const { calls, respond } = deferredMock()
    renderPeople()

    await waitFor(() => { expect(calls.some((c) => isList(1)(c.url))).toBe(true) })
    respond(isList(1), pageBody(1, 'Page1 Person'))
    await waitFor(() => { expect(screen.getByText('Page1 Person')).toBeDefined() })

    // Two requests in flight at once: page 2 (older, requested first) and page 3 (newer).
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => { expect(calls.some((c) => isList(2)(c.url))).toBe(true) })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => { expect(calls.some((c) => isList(3)(c.url))).toBe(true) })

    // The newer request settles first; the older, slower one settles after.
    respond(isList(3), pageBody(3, 'Page3 Person'))
    await waitFor(() => { expect(screen.getByText('Page3 Person')).toBeDefined() })

    respond(isList(2), pageBody(2, 'Page2 Person'))
    // The stale response gets a chance to (wrongly) apply before the assertion below.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    expect(screen.getByText('Page3 Person')).toBeDefined()
    expect(screen.queryByText('Page2 Person')).toBeNull()
  })
})

describe('the people list under the docked bulk bar', () => {
  // Measured at 390x844: the fixed bar sits at bottom-16 and covered the whole paging footer,
  // so `Showing 1-25 of 121`, `Per page` and Previous/Next were unreachable while a selection
  // was live. Invisible in a DOM-only test, hence the class-pair assertion.
  it('reserves room under the bar while a selection is live, and none once it is not', async () => {
    mockApi()
    const { container } = render(<I18nProvider><MemoryRouter><People /></MemoryRouter></I18nProvider>)

    await screen.findByText('Person 1')
    const page = container.firstElementChild
    expect(page?.className).not.toContain('pb-52')

    selectRow('Person 1')

    expect(page?.className).toContain('pb-52')
    expect(page?.className).toContain('md:pb-0')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(page?.className).not.toContain('pb-52')
  })
})
