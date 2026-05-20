'use client';

import { useTranslation } from '../../i18n/context';
import { SeverityBadge } from './SeverityBadge';
import { RelativeTime } from './RelativeTime';

interface FlagProps {
  ruleKey: string;
  severity: string;
  marketConditionId?: string | null;
  evidence?: unknown;
  explanation?: string;
  triggeredAt: string;
}

function evidencePairs(ev: unknown): Array<[string, string]> {
  if (!ev || typeof ev !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(ev as Record<string, unknown>)) {
    let s: string;
    if (typeof v === 'number') s = Number.isInteger(v) ? v.toString() : v.toFixed(2);
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else if (v == null) s = '—';
    else if (typeof v === 'string') s = v;
    else s = JSON.stringify(v);
    out.push([k, s]);
  }
  return out;
}

export function FlagCard({ ruleKey, severity, marketConditionId, evidence, explanation, triggeredAt }: FlagProps) {
  const { t } = useTranslation();
  const ruleLabel = t(`wiRules.${ruleKey}`, ruleKey);
  const ruleDesc = t(`wiRules.${ruleKey}_desc`, '');
  const sevLabel = t(`wiSeverity.${severity.toLowerCase()}`, severity);
  const pairs = evidencePairs(evidence);

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:shadow-sm transition-shadow">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={severity} label={sevLabel} />
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{ruleLabel}</h3>
        </div>
        <RelativeTime iso={triggeredAt} className="text-xs text-slate-500 dark:text-slate-400" />
      </header>

      {(explanation || ruleDesc) && (
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {explanation || ruleDesc}
        </p>
      )}

      {marketConditionId && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">{t('wiWallet.marketLabel')}:</span>{' '}
          <code className="font-mono">{marketConditionId.slice(0, 10)}...{marketConditionId.slice(-6)}</code>
        </p>
      )}

      {pairs.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-primary">
            {t('wiWallet.evidenceLabel')}
          </summary>
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {pairs.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="font-mono text-slate-500 dark:text-slate-400">{k}:</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </article>
  );
}
