import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { generateForm } from '@rjsf/shadcn'
import { customizeValidator } from '@rjsf/validator-ajv8'
import Ajv2020 from 'ajv/dist/2020'
import { getUiOptions } from '@rjsf/utils'
import type { ErrorSchema, FieldTemplateProps, UiSchema } from '@rjsf/utils'
import type { IChangeEvent } from '@rjsf/core'
import { api, ApiError } from '../api/client.ts'
import { readArray } from '../api/read.ts'
import type { FormSchema, PluginDetailDto } from '../api/types.ts'
import { Breadcrumb } from '../components/Breadcrumb.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { SecretField } from '../components/SecretField.tsx'
import { StateBadge } from '../components/StateBadge.tsx'
import { Tabs } from '../components/Tabs.tsx'
import { TONE_CLASSES } from '../components/tone.ts'
import { useT } from '../i18n.tsx'
import type { Tab } from '../components/Tabs.tsx'

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

function requiredKeys(schema: Settings): readonly string[] {
  const required = readArray<unknown>(schema.required) ?? []
  return required.filter((k): k is string => typeof k === 'string')
}

function properties(schema: Settings): Settings {
  return isPlainObject(schema.properties) ? schema.properties : {}
}

/**
 * Whether enabling would be refused, from the schema's `required` against the redacted
 * settings. Brief §7B step 5 asks the UI to prevent, not to relay: the enable route only
 * refuses after the attempt.
 */
export function missingRequired(
  schema: Record<string, unknown>, settings: Record<string, unknown>,
): readonly string[] {
  return requiredKeys(schema)
    // '' and undefined only: `false` and `0` are values a boolean or a number field may hold,
    // and treating them as absent would lock the switch on a correctly filled form.
    .filter((k) => settings[k] === undefined || settings[k] === '')
}

/** 2c's left column: `secret` overrides the JSON type, since the operator never reads one back. */
function typeWord(property: unknown, isSecret: boolean): string {
  if (isSecret) return 'secret'
  if (!isPlainObject(property)) return 'text'
  if (Array.isArray(property.enum)) return 'enum'
  if (property.type === 'number' || property.type === 'integer') return 'number'
  if (property.type === 'boolean') return 'boolean'
  return 'text'
}

/** Only a scalar default has a one-line rendering; an object or an array has none. */
function defaultWord(property: unknown): string | undefined {
  if (!isPlainObject(property)) return undefined
  const value = property.default
  const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  return scalar ? String(value) : undefined
}

function metaLine(formContext: unknown, id: string): string | undefined {
  if (!isPlainObject(formContext)) return undefined
  const lines = formContext.meta
  if (!isPlainObject(lines)) return undefined
  const line = lines[id]
  return typeof line === 'string' && line !== '' ? line : undefined
}

/**
 * The shadcn field template plus 2c's meta line. Mirrors the vendor's structure, including
 * the additional-properties wrapper and the checkbox exception that owns its own label.
 */
function FieldTemplate(props: FieldTemplateProps<Settings>): React.JSX.Element {
  const {
    id, children, displayLabel, errors, help, description, rawDescription, classNames, style,
    disabled, label, hidden, readonly, required, schema, uiSchema, registry,
  } = props
  if (hidden === true) return <div className="hidden">{children}</div>
  const Wrap = registry.templates.WrapIfAdditionalTemplate
  const context: unknown = registry.formContext
  const meta = metaLine(context, id)
  const isCheckbox = getUiOptions(uiSchema).widget === 'checkbox'
  return (
    <Wrap
      classNames={classNames}
      style={style}
      disabled={disabled}
      id={id}
      label={label}
      displayLabel={displayLabel}
      onKeyRename={props.onKeyRename}
      onKeyRenameBlur={props.onKeyRenameBlur}
      onRemoveProperty={props.onRemoveProperty}
      rawDescription={rawDescription}
      readonly={readonly}
      required={required}
      schema={schema}
      uiSchema={uiSchema}
      registry={registry}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {displayLabel === true && !isCheckbox && (
            <label htmlFor={id} className="text-body font-medium">{label}</label>
          )}
          {meta !== undefined && <span className="font-mono text-meta text-text/60">{meta}</span>}
        </div>
        {children}
        {displayLabel === true && rawDescription !== undefined && rawDescription !== '' && !isCheckbox && (
          <span className="text-meta-lg text-text/60">{description}</span>
        )}
        {errors}
        {help}
      </div>
    </Wrap>
  )
}

export function PluginSettings(): React.JSX.Element {
  const t = useT()
  const { name = '' } = useParams()
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [detail, setDetail] = useState<PluginDetailDto | null>(null)
  const [baseline, setBaseline] = useState<Settings | null>(null)
  const [formData, setFormData] = useState<Settings>({})
  const [error, setError] = useState(false)
  const [extraErrors, setExtraErrors] = useState<ErrorSchema<Settings>>({})
  const [rejectedCount, setRejectedCount] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [enabledNow, setEnabledNow] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<FormSchema>(`/api/plugins/${name}/schema`),
      api.get<unknown>(`/api/plugins/${name}/settings`),
      api.get<PluginDetailDto>(`/api/plugins/${name}`),
    ]).then(([s, settings, dto]) => {
      const initial = isPlainObject(settings) ? settings : {}
      setSchema(s)
      setDetail(dto)
      setBaseline(initial)
      setFormData(initial)
      setError(false)
    }, () => { setError(true) })
  }, [name])

  const body = schema !== null && schema.available ? schema.schema : {}
  const secrets = schema !== null && schema.available ? (readArray<string>(schema.secrets) ?? []) : []
  const fields = properties(body)
  const fieldNames = Object.keys(fields)
  const required = requiredKeys(body)
  const uiSchema: UiSchema<Settings> = Object.fromEntries(
    secrets.map((key) => [key, { 'ui:widget': SecretField }]),
  )
  // Keyed by RJSF's own field id (idPrefix 'root', separator '_'): a field template is given
  // the id, never the property name.
  const fieldMeta = Object.fromEntries(fieldNames.map((key) => {
    const property = fields[key]
    const fallback = defaultWord(property)
    const rank = required.includes(key)
      ? t('pluginSettings.required')
      : fallback === undefined ? '' : t('pluginSettings.default', { value: fallback })
    return [`root_${key}`, [typeWord(property, secrets.includes(key)), rank].filter((p) => p !== '').join(' · ')]
  }))
  // The stored settings, not the form: config/lifecycle.ts parses readSettings(db, name), so a
  // typed-but-unsaved value opening the switch would walk straight into the server's refusal.
  const outstanding = missingRequired(body, baseline ?? {})

  async function save(event: IChangeEvent<Settings>): Promise<void> {
    const current = event.formData ?? {}
    const changed = changedEntries(baseline ?? {}, current)
    setSaveError(null)
    setExtraErrors({})
    setRejectedCount(null)
    setSaved(false)
    try {
      await api.send('PUT', `/api/plugins/${name}/settings`, changed)
      setBaseline(current)
      setSaved(true)
    } catch (e) {
      const rejections = e instanceof ApiError ? readRejections(e.detail) : []
      if (rejections.length > 0) {
        setExtraErrors(Object.fromEntries(rejections.map((r) => [r.key, { __errors: [r.message] }])))
        setRejectedCount(rejections.length)
      } else {
        setSaveError(e instanceof ApiError ? e.message : t('error.generic'))
      }
    }
  }

  function discard(): void {
    setFormData(baseline ?? {})
    setExtraErrors({})
    setRejectedCount(null)
    setSaveError(null)
    setSaved(false)
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

  const commands = readArray<string>(detail?.commands) ?? []
  const tabs: readonly Tab[] = [
    { id: 'diagnosis', label: t('detail.tabDiagnosis'), to: `/plugins/${name}` },
    { id: 'configuration', label: t('detail.tabConfiguration') },
    { id: 'requirements', label: t('detail.tabRequirements'), to: `/plugins/${name}` },
    { id: 'commands', label: t('detail.tabCommands'), count: commands.length, to: `/plugins/${name}` },
  ]

  return (
    <div className="space-y-4">
      <Breadcrumb trail={[{ label: t('plugins.title'), to: '/plugins' }, { label: name, to: `/plugins/${name}` }]} />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-page">{name}</h1>
          {detail !== null && <StateBadge state={detail.state} />}
        </div>
        <Tabs tabs={tabs} active="configuration" onSelect={() => undefined} />
        {schema !== null && schema.available && (
          <p className="font-mono text-meta-lg text-text/60">
            {t(fieldNames.length === 1 ? 'pluginSettings.fieldCountOne' : 'pluginSettings.fieldCount', {
              count: fieldNames.length,
            })}
          </p>
        )}
      </header>

      {error && <p role="alert" className={`text-body ${TONE_CLASSES.crit.text}`}>{t('error.generic')}</p>}

      {schema !== null && !schema.available && (
        <EmptyState
          title={t('pluginSettings.nothingToConfigure')}
          body={t('pluginSettings.nothingToConfigureLead')}
          action={
            <div className="space-y-2">
              <p className="font-mono text-meta-lg text-text/60">{schema.reason}</p>
              {!enabledNow && detail?.enabled !== true && (
                <button
                  type="button"
                  onClick={() => { void enable() }}
                  className="rounded-md bg-accent px-3 py-2 text-body font-medium text-accent-ink"
                >
                  {t('action.enable')}
                </button>
              )}
            </div>
          }
        />
      )}

      {schema !== null && schema.available && baseline !== null && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {/* R1's boundary, the designer's own: 2c draws this alert in crit. */}
            {rejectedCount !== null && (
              <div
                role="alert"
                className={`space-y-1 rounded-xl border p-4 ${TONE_CLASSES.crit.border} ${TONE_CLASSES.crit.bg}`}
              >
                <p className={`text-title font-medium ${TONE_CLASSES.crit.text}`}>
                  {t('pluginSettings.rejectedTitle', { plugin: name })}
                </p>
                <p className="text-body">
                  {t('pluginSettings.rejectedLead', { failed: rejectedCount, total: fieldNames.length })}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-line bg-surface p-4">
              <TypedForm
                schema={body}
                uiSchema={uiSchema}
                formData={formData}
                formContext={{ meta: fieldMeta }}
                templates={{ FieldTemplate }}
                validator={validator}
                extraErrors={extraErrors}
                onChange={(e) => { setFormData(e.formData ?? {}); setSaved(false) }}
                onSubmit={(e) => { void save(e) }}
              >
                <div className="flex flex-wrap gap-2 pt-4">
                  <button type="submit" className="rounded-md bg-accent px-3 py-2 text-body font-medium text-accent-ink">
                    {t('action.save')}
                  </button>
                  <button type="button" onClick={discard} className="rounded-md border border-line px-3 py-2 text-body">
                    {t('pluginSettings.discard')}
                  </button>
                </div>
              </TypedForm>
            </div>
            {saved && <p role="status" className="text-body">{t('pluginSettings.saved')}</p>}
            {saveError !== null && <p role="alert" className={`text-body ${TONE_CLASSES.crit.text}`}>{saveError}</p>}
          </div>

          <div className="space-y-4">
            {detail !== null && !detail.enabled && (
              <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
                <h2 className="text-title font-medium">{t('action.enable')}</h2>
                <div className="flex items-center justify-between gap-3">
                  <span id="germinate-label" className="text-body">{t('pluginSettings.germinateAtStartup')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabledNow}
                    aria-labelledby="germinate-label"
                    disabled={enabledNow || outstanding.length > 0}
                    onClick={() => { void enable() }}
                    className="h-6 w-11 shrink-0 rounded-full border border-line bg-surface2 p-0.5 disabled:opacity-50 aria-checked:bg-accent"
                  >
                    <span className={`block size-4 rounded-full bg-text/70 ${enabledNow ? 'ml-auto' : ''}`} />
                  </button>
                </div>
                {outstanding.length > 0 && (
                  <p className="text-body text-text/70">
                    {t('pluginSettings.enableRefused', { fields: outstanding.join(', ') })}
                  </p>
                )}
                {enabledNow && <p className="text-body">{t('pluginSettings.enabled')}</p>}
                {enableError !== null && (
                  <p role="alert" className={`text-body ${TONE_CLASSES.crit.text}`}>{enableError}</p>
                )}
              </section>
            )}

            <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <h2 className="text-title font-medium">{t('pluginSettings.aboutSecrets')}</h2>
              <p className="text-body text-text/70">{t('pluginSettings.aboutSecretsLead')}</p>
            </section>
          </div>
        </div>
      )}

      {schema !== null && !schema.available && enabledNow && (
        <p className="text-body">{t('pluginSettings.enabled')}</p>
      )}
      {schema !== null && !schema.available && enableError !== null && (
        <p role="alert" className={`text-body ${TONE_CLASSES.crit.text}`}>{enableError}</p>
      )}
    </div>
  )
}
