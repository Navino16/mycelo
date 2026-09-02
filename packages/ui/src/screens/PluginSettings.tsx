import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { generateForm } from '@rjsf/shadcn'
import { customizeValidator } from '@rjsf/validator-ajv8'
import Ajv2020 from 'ajv/dist/2020'
import type { ErrorSchema, UiSchema } from '@rjsf/utils'
import type { IChangeEvent } from '@rjsf/core'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { FormSchema, PluginDetailDto } from '../api/types.ts'
import { SecretField } from '../components/SecretField.tsx'
import { useT } from '../i18n.tsx'

// The core emits z.toJSONSchema output, which declares draft 2020-12; the default Ajv is draft-07
// and refuses the whole form (plan defect 28).
const validator = customizeValidator({ AjvClass: Ajv2020 })

type Settings = Record<string, unknown>

// The theme's own default export is fixed to `ComponentType<FormProps<any, ...>>`;
// generateForm() returns the identical runtime component, generically typed.
const TypedForm = generateForm<Settings>()

function isPlainObject(value: unknown): value is Settings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Rejection { key: string, message: string }

/** The plugin's own issues, whatever shape they carried (plugins.ts's SettingRejection). */
function issueMessages(issues: unknown): readonly string[] {
  const list = readArray<unknown>(issues)
  if (list === undefined) return []
  return list
    .map((issue) => (isPlainObject(issue) ? issue.message : undefined))
    .filter((m): m is string => typeof m === 'string')
}

function readRejections(detail: unknown): readonly Rejection[] {
  const list = readArray<unknown>(detail)
  if (list === undefined) return []
  const out: Rejection[] = []
  for (const item of list) {
    if (!isPlainObject(item) || typeof item.key !== 'string') continue
    const message = issueMessages(item.issues).join('; ')
    if (message !== '') out.push({ key: item.key, message })
  }
  return out
}

function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Only the keys the operator actually changed: the route is a partial update (spec §8). */
function changedEntries(baseline: Settings, current: Settings): Settings {
  const out: Settings = {}
  for (const [key, value] of Object.entries(current)) {
    if (!equalValues(value, baseline[key])) out[key] = value
  }
  return out
}

export function PluginSettings(): React.JSX.Element {
  const t = useT()
  const { name = '' } = useParams()
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [pluginState, setPluginState] = useState<PluginDetailDto['state'] | null>(null)
  const [baseline, setBaseline] = useState<Settings | null>(null)
  const [formData, setFormData] = useState<Settings>({})
  const [error, setError] = useState(false)
  const [extraErrors, setExtraErrors] = useState<ErrorSchema<Settings>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [enabledNow, setEnabledNow] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<FormSchema>(`/api/plugins/${name}/schema`),
      api.get<unknown>(`/api/plugins/${name}/settings`),
      api.get<PluginDetailDto>(`/api/plugins/${name}`),
    ]).then(([s, settings, detail]) => {
      const initial = isPlainObject(settings) ? settings : {}
      setSchema(s)
      setPluginState(detail.state)
      setBaseline(initial)
      setFormData(initial)
      setError(false)
    }, () => { setError(true) })
  }, [name])

  const secrets = schema !== null && schema.available ? (readArray<string>(schema.secrets) ?? []) : []
  const uiSchema: UiSchema<Settings> = Object.fromEntries(
    secrets.map((key) => [key, { 'ui:widget': SecretField }]),
  )

  async function save(event: IChangeEvent<Settings>): Promise<void> {
    const current = event.formData ?? {}
    const changed = changedEntries(baseline ?? {}, current)
    setSaveError(null)
    setExtraErrors({})
    setSaved(false)
    try {
      await api.send('PUT', `/api/plugins/${name}/settings`, changed)
      setBaseline(current)
      setSaved(true)
    } catch (e) {
      const rejections = e instanceof ApiError ? readRejections(e.detail) : []
      if (rejections.length > 0) {
        setExtraErrors(Object.fromEntries(rejections.map((r) => [r.key, { __errors: [r.message] }])))
      } else {
        setSaveError(e instanceof ApiError ? e.message : t('error.generic'))
      }
    }
  }

  async function enable(): Promise<void> {
    setEnableError(null)
    try {
      await api.send('POST', `/api/plugins/${name}/enable`)
      setEnabledNow(true)
    } catch (e) {
      // Untranslated on purpose (spec §11): it names the field the plugin itself refused.
      setEnableError(e instanceof ApiError && typeof e.detail === 'string' ? e.detail : t('error.generic'))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-xl">{name}</h1>
      {error && <p role="alert" className="text-sm text-crit">{t('error.generic')}</p>}

      {schema !== null && !schema.available && (
        <div className="space-y-1">
          <p>{t('pluginSettings.unavailable')}</p>
          <p className="font-mono text-sm text-text/60">{schema.reason}</p>
        </div>
      )}

      {schema !== null && schema.available && baseline !== null && (
        <TypedForm
          schema={schema.schema}
          uiSchema={uiSchema}
          formData={formData}
          validator={validator}
          extraErrors={extraErrors}
          onChange={(e) => { setFormData(e.formData ?? {}) }}
          onSubmit={(e) => { void save(e) }}
        >
          <button type="submit" className="rounded-md bg-accent px-3 py-2 text-accent-ink">
            {t('action.save')}
          </button>
        </TypedForm>
      )}
      {saveError !== null && <p role="alert" className="text-sm text-crit">{saveError}</p>}

      {saved && pluginState === 'disabled' && !enabledNow && (
        <button
          type="button"
          onClick={() => { void enable() }}
          className="rounded-md bg-accent px-3 py-2 text-accent-ink"
        >
          {t('action.enable')}
        </button>
      )}
      {enabledNow && <p className="text-sm">{t('pluginSettings.enabled')}</p>}
      {enableError !== null && <p role="alert" className="text-sm text-crit">{enableError}</p>}
    </div>
  )
}
