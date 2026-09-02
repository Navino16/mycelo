import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { I18nProvider } from '../../src/i18n.tsx'
import { SecretField } from '../../src/components/SecretField.tsx'
import { PluginSettings } from '../../src/screens/PluginSettings.tsx'
import type { FormSchema, PluginDetailDto } from '../../src/api/types.ts'

describe('the secret field', () => {
  // The mask must never be readable as a value, and it must never be typed back.
  it('renders a stored credential masked, and does not put it in an input the eye can read', () => {
    render(
      <I18nProvider>
        <SecretField id="apiKey" label="API key" value="••••" onChange={() => undefined} />
      </I18nProvider>,
    )
    const input = screen.getByLabelText<HTMLInputElement>('API key')
    expect(input.type).toBe('password')
  })

  // The whole point of task 10 step 1.
  it('masks a declared secret that has never been filled in', () => {
    render(
      <I18nProvider>
        <SecretField id="apiKey" label="API key" value="" onChange={() => undefined} />
      </I18nProvider>,
    )
    expect(screen.getByLabelText<HTMLInputElement>('API key').type).toBe('password')
  })

  // Split from the brief's single test, which typed a value and asserted it was reported —
  // that proves the typed value is reported, not that an untouched field emits nothing.
  it('emits nothing when the operator does not touch it', () => {
    const seen: string[] = []
    render(
      <I18nProvider>
        <SecretField id="apiKey" label="API key" value="••••" onChange={(v) => seen.push(v)} />
      </I18nProvider>,
    )
    expect(seen).toEqual([])
  })

  it('reports the typed value when the operator changes it', () => {
    const seen: string[] = []
    render(
      <I18nProvider>
        <SecretField id="apiKey" label="API key" value="••••" onChange={(v) => seen.push(v)} />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'a-real-key' } })

    expect(seen).toEqual(['a-real-key'])
  })
})

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const SCHEMA: FormSchema = {
  available: true,
  secrets: ['token'],
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', title: 'URL' },
      token: { type: 'string', title: 'Token' },
    },
  },
}

const GERMINATED: PluginDetailDto = { name: 'vault', kind: 'enzyme', commands: ['vault'], state: 'germinated', enabled: true }
const DISABLED: PluginDetailDto = { ...GERMINATED, state: 'disabled', enabled: false }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call { method: string, url: string, body: unknown }
interface Failure { status: number, body: unknown }

interface Options {
  schema?: FormSchema
  settings?: unknown
  detail?: PluginDetailDto
  putResult?: 'ok' | Failure
  enableResult?: 'ok' | Failure
}

/** A stateful fake serving the three GETs, the settings PUT and the enable POST for 'vault'. */
function mockVault(options: Options): { calls: Call[] } {
  const calls: Call[] = []
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })

    if (method === 'GET' && url === '/api/plugins/vault/schema') return Promise.resolve(json(options.schema ?? SCHEMA))
    if (method === 'GET' && url === '/api/plugins/vault/settings') return Promise.resolve(json(options.settings ?? {}))
    if (method === 'GET' && url === '/api/plugins/vault') return Promise.resolve(json(options.detail ?? GERMINATED))

    if (method === 'PUT' && url === '/api/plugins/vault/settings') {
      const result = options.putResult ?? 'ok'
      return Promise.resolve(result === 'ok' ? json({ ok: true }) : json(result.body, result.status))
    }
    if (method === 'POST' && url === '/api/plugins/vault/enable') {
      const result = options.enableResult ?? 'ok'
      return Promise.resolve(result === 'ok' ? json({ ok: true }) : json(result.body, result.status))
    }
    return Promise.resolve(json({ error: { message: 'unhandled in test' } }, 404))
  }) as unknown as typeof fetch
  return { calls }
}

function renderSettings(): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/plugins/vault/settings']}>
        <Routes><Route path="/plugins/:name/settings" element={<PluginSettings />} /></Routes>
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('the generated settings form', () => {
  it('says something went wrong when the initial fetch fails', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderSettings()

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Something went wrong')
  })

  it('renders the form on success, with no error banner', async () => {
    mockVault({ settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // available: false is a state, not a fetch failure: no form, no button, no alert —
  // only the sentence and the plugin's own raw reason.
  it('renders the unavailable sentence and the raw reason, with no form and no alert', async () => {
    mockVault({ schema: { available: false, reason: 'no toJsonSchema' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByText('no toJsonSchema')).toBeDefined() })
    expect(screen.getByText('This plugin has nothing to configure here.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The integration, not the widget alone: a key named in `secrets` must reach RJSF's
  // uiSchema and come out as a password input; an ordinary key must not.
  it('renders a declared secret through the uiSchema, and a plain key as an ordinary input', async () => {
    mockVault({ settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.getByLabelText<HTMLInputElement>('URL').type).toBe('text')
    expect(screen.getByLabelText<HTMLInputElement>('Token').type).toBe('password')
  })

  it('sends only the field the operator changed, leaving a stored secret at its mask', async () => {
    const { calls } = mockVault({ settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ url: 'http://y' })
  })

  it('renders the field message from a 400 beside the field, not the generic error', async () => {
    mockVault({
      settings: { url: 'http://x', token: '••••' },
      putResult: {
        status: 400,
        body: {
          error: {
            message: 'refused',
            detail: [{ key: 'url', issues: [{ path: ['url'], message: 'must start with http:// or https://' }] }],
          },
        },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(screen.queryByText('must start with http:// or https://')).not.toBeNull() })
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })

  it('offers the enable action after a successful save, for a disabled plugin', async () => {
    mockVault({ detail: DISABLED, settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(screen.getByRole('button', { name: 'Enable' })).toBeDefined() })
  })

  it('never offers the enable action for an already germinated plugin', async () => {
    const { calls } = mockVault({ settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
  })

  // RJSF passes formData through as `value`, undefined for a never-stored key; typing then
  // makes it defined, the uncontrolled-to-controlled transition React warns about (plan defect 1).
  it('masks a never-filled secret with an empty value and no React controlled-input warning', async () => {
    const errorSpy = spyOn(console, 'error')
    try {
      mockVault({ settings: { url: 'http://x' } })
      renderSettings()

      await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
      const tokenInput = screen.getByLabelText<HTMLInputElement>('Token')
      expect(tokenInput.type).toBe('password')
      expect(tokenInput.value).toBe('')

      fireEvent.change(tokenInput, { target: { value: 'a-real-key' } })

      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('uncontrolled'))).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('renders the refusal naming the missing field when enabling fails', async () => {
    mockVault({
      detail: DISABLED,
      settings: { url: 'http://x', token: '••••' },
      enableResult: {
        status: 400,
        body: { error: { message: 'refused', detail: 'configuration is incomplete: token: field required' } },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Enable' })).toBeDefined() })

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => { expect(screen.getByText('configuration is incomplete: token: field required')).toBeDefined() })
  })
})
