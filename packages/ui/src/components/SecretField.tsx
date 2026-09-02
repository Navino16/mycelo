interface Props {
  id: string
  label: string
  value: string | undefined
  onChange: (next: string) => void
}

export function SecretField({ id, label, value, onChange }: Props): React.JSX.Element {
  return (
    <label className="block space-y-1" htmlFor={id}>
      <span className="text-sm">{label}</span>
      <input
        id={id}
        type="password"
        value={value ?? ''}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value) }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono"
      />
    </label>
  )
}
