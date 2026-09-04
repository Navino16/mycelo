import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { generateForm } from '@rjsf/shadcn'
import { customizeValidator } from '@rjsf/validator-ajv8'
import Ajv2020 from 'ajv/dist/2020'
import { buttonId, getUiOptions } from '@rjsf/utils'
import type {
  ArrayFieldItemTemplateProps, ArrayFieldTemplateProps, ErrorSchema, FieldTemplateProps,
  IconButtonProps, UiSchema,
} from '@rjsf/utils'
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
import { plural, useT } from '../i18n.tsx'
import { pluginTrail } from '../kinds.ts'
import type { Tab } from '../components/Tabs.tsx'
import type { Translate } from '../i18n.tsx'
import type { StringKey } from '../../locales/en.ts'

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

/**
 * 2c's left column: `secret` overrides the JSON type, since the operator never reads one back.
 * A catalogue key, not the word: the rank beside it is translated, and `text · Obligatoire`
 * is one English word and one French word on one line.
 */
function typeWord(property: unknown, isSecret: boolean): StringKey {
  if (isSecret) return 'pluginSettings.type.secret'
  if (!isPlainObject(property)) return 'pluginSettings.type.text'
  if (Array.isArray(property.enum)) return 'pluginSettings.type.enum'
  if (property.type === 'array') return 'pluginSettings.type.list'
  if (property.type === 'number' || property.type === 'integer') return 'pluginSettings.type.number'
  if (property.type === 'boolean') return 'pluginSettings.type.boolean'
  return 'pluginSettings.type.text'
}

/** Only a scalar default has a one-line rendering; an object or an array has none. */
function defaultWord(property: unknown): string | undefined {
  if (!isPlainObject(property)) return undefined
  const value = property.default
  const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  return scalar ? String(value) : undefined
}

/** 2c's right column: the type word, then the rank — `required`, or the default it falls back to. */
function metaFor(t: Translate, property: unknown, required: boolean, isSecret: boolean): string {
  const fallback = defaultWord(property)
  const rank = required
    ? t('pluginSettings.required')
    : fallback === undefined ? '' : t('pluginSettings.default', { value: fallback })
  return [t(typeWord(property, isSecret)), rank].filter((part) => part !== '').join(' · ')
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
  const t = useT()
  const {
    id, children, displayLabel, errors, help, description, rawDescription, classNames, style,
    disabled, label, hidden, readonly, required, schema, uiSchema, registry,
  } = props
  if (hidden === true) return <div className="hidden">{children}</div>
  const Wrap = registry.templates.WrapIfAdditionalTemplate
  const context: unknown = registry.formContext
  // The precomputed line for a top-level field, which is the only one that knows about
  // secrets; anything nested is derived from the schema RJSF hands this template, since
  // `meta` is keyed by id and no id below the root is in it. An array owns its own row
  // (ArrayFieldTemplate), so the line here would be an orphan above it.
  const meta = schema.type === 'array'
    ? undefined
    : metaLine(context, id) ?? (schema.type === 'object' ? undefined : metaFor(t, schema, required === true, false))
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

/**
 * The token control the four array buttons share. Only RJSF's three behavioural props are
 * read: the rest of `IconButtonProps` is the vendor theme's icon and variant plumbing, which
 * is exactly what this replaces.
 */
function ArrayControl(
  { id, onClick, disabled, label, glyph }: IconButtonProps<Settings> & { label: string, glyph?: string },
): React.JSX.Element {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      disabled={disabled}
      aria-label={glyph === undefined ? undefined : label}
      title={glyph === undefined ? undefined : label}
      className="rounded-md border border-line px-2 py-1 text-meta-lg disabled:opacity-40"
    >
      {glyph ?? label}
    </button>
  )
}

function AddButton(props: IconButtonProps<Settings>): React.JSX.Element {
  const t = useT()
  return <ArrayControl {...props} label={t('pluginSettings.addItem')} />
}

function RemoveButton(props: IconButtonProps<Settings>): React.JSX.Element {
  const t = useT()
  return <ArrayControl {...props} label={t('pluginSettings.removeItem')} />
}

function MoveUpButton(props: IconButtonProps<Settings>): React.JSX.Element {
  const t = useT()
  return <ArrayControl {...props} label={t('pluginSettings.moveUp')} glyph="\u2191" />
}

function MoveDownButton(props: IconButtonProps<Settings>): React.JSX.Element {
  const t = useT()
  return <ArrayControl {...props} label={t('pluginSettings.moveDown')} glyph="\u2193" />
}

/**
 * 2c's one row per field, applied to an array: its label and its own meta line on one line,
 * then the items. The vendor theme titles the array a second time in an `<h5>` under
 * FieldTemplate's line, and its add control is the theme's outline variant.
 */
function ArrayFieldTemplate(props: ArrayFieldTemplateProps<Settings>): React.JSX.Element {
  const { canAdd, disabled, readonly, items, onAddClick, title, uiSchema, fieldPathId, registry } = props
  const context: unknown = registry.formContext
  const meta = metaLine(context, fieldPathId.$id)
  const { AddButton: Add } = registry.templates.ButtonTemplates
  return (
    <div className="flex flex-col gap-2" data-testid={`array-field-${fieldPathId.$id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium">{getUiOptions(uiSchema).title ?? title}</span>
        {meta !== undefined && <span className="font-mono text-meta text-text/60">{meta}</span>}
      </div>
      {items}
      {canAdd === true && (
        <Add
          id={buttonId(fieldPathId, 'add')}
          onClick={onAddClick}
          disabled={disabled === true || readonly === true}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
    </div>
  )
}

/**
 * One item as a card with its own header row: the entry's number on the left, its controls on
 * the right. The vendor centres the controls against the whole block, so they land beside
 * whichever field happens to sit at the item's middle.
 */
function ArrayFieldItemTemplate(props: ArrayFieldItemTemplateProps<Settings>): React.JSX.Element {
  const t = useT()
  const { children, buttonsProps, hasToolbar, index, registry } = props
  const Buttons = registry.templates.ArrayFieldItemButtonsTemplate
  return (
    <div
      data-testid={`array-item-${String(index)}`}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface2 p-3"
    >
      <div
        data-testid={`array-item-header-${String(index)}`}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <span className="font-mono text-meta-lg text-text/60">
          {t('pluginSettings.itemLabel', { n: index + 1 })}
        </span>
        {hasToolbar && <span className="flex gap-2"><Buttons {...buttonsProps} /></span>}
      </div>
      {children}
    </div>
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

  // allSettled, not all: the detail DTO feeds the badge, the trail's kind crumb and the tab
  // count, and a refusal of it must not blank the form, which is the screen's whole purpose.
  useEffect(() => {
    void Promise.allSettled([
      api.get<FormSchema>(`/api/plugins/${name}/schema`),
      api.get<unknown>(`/api/plugins/${name}/settings`),
      api.get<PluginDetailDto>(`/api/plugins/${name}`),
    ]).then(([s, settings, dto]) => {
      setDetail(dto.status === 'fulfilled' ? dto.value : null)
      if (s.status !== 'fulfilled' || settings.status !== 'fulfilled') { setError(true); return }
      const initial = isPlainObject(settings.value) ? settings.value : {}
      setSchema(s.value)
      setBaseline(initial)
      setFormData(initial)
      setError(false)
    })
  }, [name])

  const body = schema !== null && schema.available ? schema.schema : {}
  const secrets = schema !== null && schema.available ? (readArray<string>(schema.secrets) ?? []) : []
  const fields = properties(body)
  const fieldNames = Object.keys(fields)
  const required = requiredKeys(body)
  // `ui:label: false` on an array's items is what drops RJSF's own `<name>-<index>` heading
  // (ObjectField.js:248); ArrayFieldItemTemplate numbers the entry instead.
  const uiSchema: UiSchema<Settings> = {
    ...Object.fromEntries(fieldNames
      .filter((key) => isPlainObject(fields[key]) && fields[key].type === 'array')
      .map((key) => [key, { items: { 'ui:label': false } }])),
    ...Object.fromEntries(secrets.map((key) => [key, { 'ui:widget': SecretField }])),
  }
  // Keyed by RJSF's own field id (idPrefix 'root', separator '_'): a field template is given
  // the id, never the property name.
  const fieldMeta = Object.fromEntries(fieldNames.map((key) => (
    [`root_${key}`, metaFor(t, fields[key], required.includes(key), secrets.includes(key))]
  )))
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
  // Each sibling names its own panel: PluginDetail holds the panel in `?panel=`, so three
  // links to the bare route all landed on Diagnosis.
  const tabs: readonly Tab[] = [
    { id: 'diagnosis', label: t('detail.tabDiagnosis'), to: `/plugins/${name}?panel=diagnosis` },
    { id: 'configuration', label: t('detail.tabConfiguration') },
    { id: 'requirements', label: t('detail.tabRequirements'), to: `/plugins/${name}?panel=requirements` },
    {
      id: 'commands',
      label: t('detail.tabCommands'),
      count: detail === null ? undefined : commands.length,
      to: `/plugins/${name}?panel=commands`,
    },
  ]

  return (
    <div className="space-y-4">
      <Breadcrumb trail={pluginTrail(t, name, detail?.kind)} />

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-page">{name}</h1>
          {/* The enable route answers { ok, restartRequired }: folded in, or the badge reads
              `Disabled` beside the switch that just reported the restart. */}
          {detail !== null && <StateBadge state={enabledNow ? 'pending' : detail.state} />}
        </div>
        <Tabs tabs={tabs} active="configuration" onSelect={() => undefined} />
        {schema !== null && schema.available && (
          <p className="font-mono text-meta-lg text-text/60">
            {plural(t, 'pluginSettings.fieldCount', fieldNames.length, {
              count: fieldNames.length,
            })}
          </p>
        )}
      </header>

      {error && <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{t('error.generic')}</p>}

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
                templates={{
                  FieldTemplate,
                  ArrayFieldTemplate,
                  ArrayFieldItemTemplate,
                  ButtonTemplates: { AddButton, RemoveButton, MoveUpButton, MoveDownButton },
                }}
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
                  <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{enableError}</p>
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
        <p role="alert" className={`text-body ${TONE_CLASSES.warn.text}`}>{enableError}</p>
      )}
    </div>
  )
}
