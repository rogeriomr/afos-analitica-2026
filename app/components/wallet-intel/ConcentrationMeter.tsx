interface Props {
  label: string;
  /** 0-100 percentage. */
  percent: number;
  /** Right-side caption (e.g., "Top 5"). */
  caption?: string;
  /**
   * Optional outcome name (e.g. "Lula"). When provided the meter prefixes its
   * label with "Concentration — {outcomeName}" instead of the bare `label`.
   * Existing callers without this prop keep their previous behaviour.
   */
  outcomeName?: string;
  /**
   * Optional translated "Concentration" word — passed in so the component
   * stays presentational and doesn't need to grow an i18n dependency.
   * Defaults to "Concentration" when missing.
   */
  concentrationLabel?: string;
}

function colorFor(pct: number): string {
  if (pct >= 75) return 'bg-red-500';
  if (pct >= 50) return 'bg-orange-500';
  if (pct >= 25) return 'bg-amber-400';
  return 'bg-emerald-500';
}

function textColorFor(pct: number): string {
  if (pct >= 75) return 'text-red-600 dark:text-red-300';
  if (pct >= 50) return 'text-orange-600 dark:text-orange-300';
  if (pct >= 25) return 'text-amber-600 dark:text-amber-300';
  return 'text-emerald-600 dark:text-emerald-300';
}

export function ConcentrationMeter({
  label,
  percent,
  caption,
  outcomeName,
  concentrationLabel = 'Concentration',
}: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  const displayLabel = outcomeName
    ? `${concentrationLabel} — ${outcomeName} · ${label}`
    : label;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{displayLabel}</span>
        <span className={`text-lg font-bold tabular-nums ${textColorFor(clamped)}`}>
          {clamped.toFixed(1)}%
        </span>
      </div>
      <div
        className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={displayLabel}
      >
        <div className={`${colorFor(clamped)} h-full transition-[width] duration-300`} style={{ width: `${clamped}%` }} />
      </div>
      {caption && <p className="mt-1 text-[11px] text-slate-500">{caption}</p>}
    </div>
  );
}
