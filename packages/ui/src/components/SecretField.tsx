interface Props {
  id: string
  value: string | undefined
  onChange: (next: string) => void
}

/**
 * The bare input, no label: the field template renders the one label the field gets. A label
 * here too is the `apiKey*` / `apiKey` pair the design review found.
 */
export function SecretField({ id, value, onChange }: Props): React.JSX.Element {
  return (
    <input
      id={id}
      type="password"
      value={value ?? ''}
      autoComplete="off"
      onChange={(e) => { onChange(e.target.value) }}
      className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono"
    />
  )
}
