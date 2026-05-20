interface Props {
  score: number | null;
  label?: string;
  /** Sublabel shown below the bar. */
  hint?: string;
  /** Empty state caption when score is null. */
  emptyLabel?: string;
  /** Visual variant. */
  variant?: 'bar' | 'compact';
}

function colorFor(score: number): string {
  if (score >= 75) return 'bg-red-500';
  if (score >= 50) return 'bg-orange-500';
  if (score >= 25) return 'bg-amber-400';
  return 'bg-blue-400';
}

function textColorFor(score: number): string {
  if (score >= 75) return 'text-red-600 dark:text-red-300';
  if (score >= 50) return 'text-orange-600 dark:text-orange-300';
  if (score >= 25) return 'text-amber-600 dark:text-amber-300';
  return 'text-blue-600 dark:text-blue-300';
}

export function ScoreGauge({ score, label, hint, emptyLabel = '—', variant = 'bar' }: Props) {
  if (score == null) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</div>
    );
  }
  const clamped = Math.max(0, Math.min(100, score));
  const fill = colorFor(clamped);
  const tone = textColorFor(clamped);

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 min-w-[120px]">
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className={`${fill} h-full transition-[width] duration-300`}
            style={{ width: `${clamped}%` }}
            role="progressbar"
            aria-valuenow={Math.round(clamped)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className={`text-xs font-mono tabular-nums font-semibold ${tone}`}>
          {Math.round(clamped)}
        </span>
      </div>
    );
  }

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
          <span className={`text-2xl font-bold tabular-nums ${tone}`}>{Math.round(clamped)}</span>
        </div>
      )}
      <div
        className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'score'}
      >
        <div className={`${fill} h-full transition-[width] duration-300`} style={{ width: `${clamped}%` }} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{hint}</p>}
    </div>
  );
}
