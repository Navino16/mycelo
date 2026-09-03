import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TONE_CLASSES } from '../../src/components/tone.ts'
import { I18nProvider } from '../../src/i18n.tsx'
import { SecretField } from '../../src/components/SecretField.tsx'
import { PluginSettings } from '../../src/screens/PluginSettings.tsx'
import type { FormSchema, PluginDetailDto } from '../../src/api/types.ts'

/**
 * The widget renders the bare input; the field template renders the label. The test stands in
 * for the template, so a label the widget renders again would be the second one.
 */
function renderSecret(value: string, onChange: (next: string) => void = () => undefined): void {
  render(
    <I18nProvider>
      <label htmlFor="apiKey">API key</label>
      <SecretField id="apiKey" value={value} onChange={onChange} />
    </I18nProvider>,
  )
}

describe('the secret field', () => {
  // The mask must never be readable as a value, and it must never be typed back.
  it('renders a stored credential masked, and does not put it in an input the eye can read', () => {
    renderSecret('\u2022\u2022\u2022\u2022')

    expect(screen.getByLabelText<HTMLInputElement>('API key').type).toBe('password')
  })

  // The whole point of task 10 step 1.
  it('masks a declared secret that has never been filled in', () => {
    renderSecret('')

    expect(screen.getByLabelText<HTMLInputElement>('API key').type).toBe('password')
  })

  // Split from the brief's single test, which typed a value and asserted it was reported —
  // that proves the typed value is reported, not that an untouched field emits nothing.
  it('emits nothing when the operator does not touch it', () => {
    const seen: string[] = []
    renderSecret('\u2022\u2022\u2022\u2022', (v) => seen.push(v))

    expect(seen).toEqual([])
  })

  it('reports the typed value when the operator changes it', () => {
    const seen: string[] = []
    renderSecret('\u2022\u2022\u2022\u2022', (v) => seen.push(v))
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'a-real-key' } })

    expect(seen).toEqual(['a-real-key'])
  })

  it('renders no label of its own, leaving the template label as the only one', () => {
    renderSecret('')

    const input = screen.getByLabelText<HTMLInputElement>('API key')
    expect(input.closest('label')).toBeNull()
    expect(document.querySelectorAll(`label[for="${input.id}"]`)).toHaveLength(1)
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

/** A schema whose one required field discriminates the enable gate's two halves. */
const REQUIRING: FormSchema = {
  available: true,
  secrets: [],
  schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', title: 'URL' } } },
}

const REQUIRING_SECRET: FormSchema = {
  available: true,
  secrets: ['token'],
  schema: { type: 'object', required: ['token'], properties: { token: { type: 'string', title: 'Token' } } },
}

/** One property of every kind the field meta line names (2c's left column). */
const RICH: FormSchema = {
  available: true,
  secrets: ['apiKey'],
  schema: {
    type: 'object',
    required: ['baseUrl', 'apiKey'],
    properties: {
      baseUrl: { type: 'string', title: 'Base URL' },
      apiKey: { type: 'string', title: 'API key' },
      profile: { type: 'string', title: 'Quality profile', enum: ['HD-1080p', 'HD-720p'] },
      timeout: { type: 'number', title: 'Timeout', default: 30 },
      monitored: { type: 'boolean', title: 'Add monitored' },
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

  // R1's boundary: crit belongs to the mute bot, an inline field error and a destructive
  // action. A load failure is none of the three, and PluginDetail one tab away paints it amber.
  it('paints the load failure amber, never the mute red', async () => {
    globalThis.fetch = mock(() => Promise.resolve(json({ error: { message: 'x' } }, 500)))
    renderSettings()

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain(TONE_CLASSES.warn.text)
    expect(alert.className).not.toContain(TONE_CLASSES.crit.text)
  })

  it('renders the form on success, with no error banner', async () => {
    mockVault({ settings: { url: 'http://x', token: '••••' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // available: false is a state, not a fetch failure: no form, no button, no alert —
  // only the sentence and the plugin's own raw reason.
  it('renders the empty-schema state and the raw reason, with no field and no alert', async () => {
    mockVault({ schema: { available: false, reason: 'no toJsonSchema' }, detail: DISABLED })
    renderSettings()

    await waitFor(() => { expect(screen.getByText('no toJsonSchema')).toBeDefined() })
    expect(screen.getByText('Nothing to configure')).toBeDefined()
    expect(screen.getByText(/publishes an empty schema/)).toBeDefined()
    // 2c-config-form-mobile-empty offers Enable here: an empty schema is nothing to fill in,
    // so the plugin can germinate straight away.
    expect(screen.getByRole('button', { name: 'Enable' })).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => { expect(screen.getByText('Enabled. It takes effect after a restart.')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
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

  // The core emits z.toJSONSchema output, which declares draft 2020-12; a draft-07 Ajv refuses
  // the whole form with "no schema with key or ref" and nothing is ever PUT (plan defect 28).
  it('saves a schema declaring draft 2020-12, the draft the core actually emits', async () => {
    const draft2020: FormSchema = {
      ...SCHEMA,
      schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...SCHEMA.schema as object },
    }
    const { calls } = mockVault({ schema: draft2020, settings: { url: 'http://x', token: '••••' } })
    renderSettings()
    const url = await screen.findByLabelText('URL')
    fireEvent.change(url, { target: { value: 'http://y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ url: 'http://y' })
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

  // Discriminates equalValues' object-deep-equal branch from a bare `===`: a nested object
  // field the operator never touched must not be resent just because RJSF gave it a new
  // object reference on every render.
  it('omits an untouched nested-object field from the PUT body', async () => {
    const nestedSchema: FormSchema = {
      available: true,
      secrets: [],
      schema: {
        type: 'object',
        properties: {
          url: { type: 'string', title: 'URL' },
          meta: { type: 'object', properties: { tag: { type: 'string', title: 'Tag' } } },
        },
      },
    }
    const { calls } = mockVault({ schema: nestedSchema, settings: { url: 'http://x', meta: { tag: 'a' } } })
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

  // Discriminates the `typeof m === 'string'` filter: a malformed issue with no message
  // must not surface the literal word "undefined" beside a field the operator can read.
  it('does not render "undefined" for a malformed issue with no message', async () => {
    mockVault({
      settings: { url: 'http://x', token: '••••' },
      putResult: {
        status: 400,
        body: {
          error: {
            message: 'refused',
            detail: [{ key: 'url', issues: [{ path: ['url'], message: 'must start with http://' }, { path: ['url'] }] }],
          },
        },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Exact string match (not a substring regex): a stray '; ' from an unfiltered undefined
    // entry would break this exact equality without ever spelling the word "undefined".
    await waitFor(() => {
      expect(screen.queryAllByText('must start with http://').length).toBeGreaterThan(0)
    })
  })

  // Both halves. The first alone passes for a switch that is always off; the second alone
  // passes for one that is never gated (brief §7B step 5).
  it('refuses the switch while a required field is unset, and allows it once it is saved', async () => {
    const { calls } = mockVault({ schema: REQUIRING, detail: DISABLED, settings: {} })
    renderSettings()

    const url = await screen.findByLabelText('URL')
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getByText(/Cannot be switched on: url required and currently unset/)).toBeDefined()

    fireEvent.change(url, { target: { value: 'http://x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(calls.some((c) => c.method === 'PUT')).toBe(true) })

    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(false) })
    expect(screen.queryByText(/Cannot be switched on/)).toBeNull()
  })

  // config/lifecycle.ts refuses on the STORED settings, so a typed-but-unsaved value opening the
  // switch would put the operator straight into the server refusal step 5 exists to prevent.
  it('keeps the switch shut for a required value typed but not saved', async () => {
    mockVault({ schema: REQUIRING, detail: DISABLED, settings: {} })
    renderSettings()

    const url = await screen.findByLabelText('URL')
    fireEvent.change(url, { target: { value: 'http://x' } })

    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getByText(/Cannot be switched on: url required and currently unset/)).toBeDefined()
  })

  // A stored credential arrives as the mask, which is a value: a plugin whose only required
  // field is already stored must not be locked out of germinating.
  it('reads a stored secret at its mask as a satisfied required field', async () => {
    mockVault({ schema: REQUIRING_SECRET, detail: DISABLED, settings: { token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('Token')).toBeDefined() })
    expect(screen.getByRole<HTMLInputElement>('switch').disabled).toBe(false)
  })

  it('enables the plugin through the switch and says the restart is what applies it', async () => {
    const { calls } = mockVault({ detail: DISABLED, settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => { expect(screen.getByText('Enabled. It takes effect after a restart.')).toBeDefined() })
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plugins/vault/enable')).toBe(true)
    // Checked and inert, not gone: the operator must see the state the click produced.
    const settled = screen.getByRole<HTMLInputElement>('switch')
    expect(settled.getAttribute('aria-checked')).toBe('true')
    expect(settled.disabled).toBe(true)
  })

  it('never offers Enable for an already germinated plugin with an empty schema', async () => {
    mockVault({ schema: { available: false, reason: 'no toJsonSchema' }, detail: GERMINATED })
    renderSettings()

    await waitFor(() => { expect(screen.getByText('no toJsonSchema')).toBeDefined() })
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
  })

  it('never offers the switch for an already enabled plugin', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.queryByRole('switch')).toBeNull()
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
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => { expect(screen.getByText('configuration is incomplete: token: field required')).toBeDefined() })
  })

  // The other half of R1's boundary: enabling a plugin is not a destructive action, so its
  // refusal is amber like every other action failure on the branch.
  it('paints the enable refusal amber, never the mute red', async () => {
    mockVault({
      detail: DISABLED,
      settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' },
      enableResult: { status: 400, body: { error: { message: 'refused', detail: 'it said no' } } },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('switch'))

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain(TONE_CLASSES.warn.text)
    expect(alert.className).not.toContain(TONE_CLASSES.crit.text)
  })

  // The boundary in the other direction: 2c draws the server's save rejection in crit, and
  // that is the designer's own exception — it must not be swept amber with the rest.
  it('keeps the save rejection crit, which is the designer\'s own exception', async () => {
    mockVault({
      settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' },
      putResult: {
        status: 400,
        body: { error: { message: 'refused', detail: [{ key: 'url', issues: [{ message: 'not a URL' }] }] } },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const summary = await screen.findByText('Saved, but rejected by vault')
    expect(summary.closest('[role="alert"]')?.className).toContain(TONE_CLASSES.crit.border)
  })
})

describe("the generated form's page frame", () => {
  it('carries the plugin header and the tab strip, with Configuration the active tab', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.getByRole('heading', { name: 'vault' })).toBeDefined()
    expect(screen.getByText('Germinated')).toBeDefined()
    // The three siblings navigate back to the detail route, so the two read as one screen.
    for (const label of ['Diagnosis', 'Requirements']) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/plugins/vault')
    }
    expect(screen.getByRole('button', { name: 'Configuration' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('counts the schema properties under the title', async () => {
    mockVault({ schema: RICH, detail: DISABLED, settings: {} })
    renderSettings()

    expect(await screen.findByText("5 fields from the plugin's schema")).toBeDefined()
  })

  // Singular key at exactly one, the project's convention: '1 fields' is what it exists to stop.
  it('counts a one-property schema in the singular', async () => {
    mockVault({ schema: REQUIRING, detail: DISABLED, settings: {} })
    renderSettings()

    expect(await screen.findByText("1 field from the plugin's schema")).toBeDefined()
  })

  // 2c's left column: the type word, then required or the default. Read from the schema alone,
  // with `secrets` overriding the type — a secret is a string the operator must not read back.
  it('names each field type and whether it is required or defaulted', async () => {
    mockVault({ schema: RICH, detail: DISABLED, settings: {} })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('Base URL')).toBeDefined() })
    expect(screen.getByText('text \u00b7 required')).toBeDefined()
    expect(screen.getByText('secret \u00b7 required')).toBeDefined()
    expect(screen.getByText('enum')).toBeDefined()
    expect(screen.getByText('number \u00b7 default 30')).toBeDefined()
    expect(screen.getByText('boolean')).toBeDefined()
    // The checkbox widget renders its own label, so the template must not render a second one.
    const monitored = screen.getByLabelText<HTMLInputElement>('Add monitored')
    expect(document.querySelectorAll(`label[for="${monitored.id}"]`)).toHaveLength(1)
  })

  it('heads a rejected save with the summary naming the plugin and how many fields failed', async () => {
    mockVault({
      settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' },
      putResult: {
        status: 400,
        body: {
          error: {
            message: 'refused',
            detail: [{ key: 'url', issues: [{ path: ['url'], message: 'must start with http://' }] }],
          },
        },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved, but rejected by vault')).toBeDefined()
    expect(screen.getByText(/1 of 2 fields failed validation on the server/)).toBeDefined()
  })

  // Discriminates a summary rendered whenever a save happened from one rendered on a refusal.
  // The acknowledgement is the anchor: asserting the negatives alone would pass before the click.
  it('acknowledges a successful save, and heads it with no rejection summary', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('status')).textContent).toBe('Saved.')
    expect(screen.queryByText('Saved, but rejected by vault')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops the acknowledgement as soon as the operator edits again', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('status')

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://z' } })

    expect(screen.queryByRole('status')).toBeNull()
  })

  // A refused save must not read as one that landed.
  it('shows no acknowledgement when the server refuses the save', async () => {
    mockVault({
      settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' },
      putResult: {
        status: 400,
        body: {
          error: {
            message: 'refused',
            detail: [{ key: 'url', issues: [{ path: ['url'], message: 'must start with http://' }] }],
          },
        },
      },
    })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved, but rejected by vault')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('puts the form back to the fetched baseline when the operator discards', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    const url = await screen.findByLabelText<HTMLInputElement>('URL')
    fireEvent.change(url, { target: { value: 'http://y' } })
    expect(screen.getByLabelText<HTMLInputElement>('URL').value).toBe('http://y')

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))

    await waitFor(() => { expect(screen.getByLabelText<HTMLInputElement>('URL').value).toBe('http://x') })
  })

  it('states the secret rule the API enforces', async () => {
    mockVault({ settings: { url: 'http://x', token: '\u2022\u2022\u2022\u2022' } })
    renderSettings()

    await waitFor(() => { expect(screen.getByLabelText('URL')).toBeDefined() })
    expect(screen.getByText('About secrets')).toBeDefined()
    expect(screen.getByText(/never returned by the API, and excluded from exports/)).toBeDefined()
  })
})
