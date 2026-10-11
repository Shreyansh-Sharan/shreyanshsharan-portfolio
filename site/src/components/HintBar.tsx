export function HintBar({ hints }: { hints: [string, string][] }) {
  return (
    <div className="hint-bar" aria-hidden="true">
      {hints.map(([key, label]) => (
        <span key={label}>
          <kbd>{key}</kbd> {label}
        </span>
      ))}
    </div>
  )
}
