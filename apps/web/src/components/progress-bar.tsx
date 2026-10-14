/**
 * Thin accent progress bar for the import screens. `value` is a 0–100
 * percentage, or `null` while the amount is unknown (indeterminate: no
 * `aria-valuenow`, a sliding segment). `busy` keeps a segment sliding over a
 * determinate bar so work between steps still reads as running: the fill drops
 * to a muted accent, leaving the full-strength segment visible all the way.
 */
export function ProgressBar({
  label,
  value,
  busy = false,
}: {
  label: string;
  value: number | null;
  busy?: boolean;
}): React.ReactElement {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className="relative h-2 w-full overflow-hidden rounded-full bg-edge"
    >
      {value === null ? (
        <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent animate-progress-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-accent" />
      ) : (
        <>
          <div
            className={`h-full transition-[width] motion-reduce:transition-none ${
              busy
                ? 'bg-accent/40 motion-reduce:bg-accent motion-reduce:min-w-2'
                : 'bg-accent'
            }`}
            style={{ width: `${String(Math.min(100, Math.max(0, value)))}%` }}
          />
          {busy && (
            <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent animate-progress-indeterminate motion-reduce:hidden" />
          )}
        </>
      )}
    </div>
  );
}
