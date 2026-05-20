import type { ReactNode } from 'react';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

const STYLES: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/60',
  high: 'bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-800/60',
  medium: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/60',
  low: 'bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/60',
};

interface Props {
  severity: string;
  label: string;
  /** Optional small adornment shown after the label (e.g., flag count). */
  trailing?: ReactNode;
  /** Compact pill (single letter) for dense tables. */
  compact?: boolean;
  /** Hover/focus title for screen readers. */
  title?: string;
}

function normalizeSeverity(s: string): Severity {
  const v = s.toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low') return v;
  return 'low';
}

export function SeverityBadge({ severity, label, trailing, compact = false, title }: Props) {
  const sev = normalizeSeverity(severity);
  const cls = STYLES[sev];
  const size = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ring-1 font-semibold uppercase tracking-wide ${cls} ${size}`}
      title={title ?? label}
    >
      <span>{label}</span>
      {trailing != null && <span className="font-normal opacity-80">{trailing}</span>}
    </span>
  );
}
