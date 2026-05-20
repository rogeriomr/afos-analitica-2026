import { getMessages } from '../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../lib/i18n/config';
import { getSummary } from '../../../lib/wallet-intel/queries';
import { DetectionActions } from '../../../components/wallet-intel/DetectionActions';
import { SeverityBadge } from '../../../components/wallet-intel/SeverityBadge';
import { prisma } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function tFor(messages: Awaited<ReturnType<typeof getMessages>>) {
  return function t(key: string, fallback?: string): string {
    const [section, field] = key.split('.', 2);
    const v = messages[section]?.[field];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(', ');
    return fallback ?? key;
  };
}

interface RuleRow {
  ruleKey: string;
  displayName: string;
  severity: string;
  enabled: boolean;
  paramsJson: unknown;
}

async function loadRules(): Promise<RuleRow[] | null> {
  if (!prisma) return null;
  try {
    const rows = await prisma.flagRule.findMany({
      orderBy: [{ enabled: 'desc' }, { ruleKey: 'asc' }],
      select: {
        ruleKey: true,
        displayName: true,
        severity: true,
        enabled: true,
        paramsJson: true,
      },
    });
    return rows;
  } catch (err) {
    console.error('[wallet-intel] detection page: failed to load FlagRule rows:', err);
    return null;
  }
}

function formatParams(params: unknown): string {
  if (params == null) return '—';
  if (typeof params === 'object' && !Array.isArray(params)) {
    const entries = Object.entries(params as Record<string, unknown>);
    if (entries.length === 0) return '—';
  }
  try {
    return JSON.stringify(params);
  } catch {
    return String(params);
  }
}

export default async function DetectionPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  // Pull lastIngestedAt so the page header can show it without a client roundtrip.
  const [summary, rules] = await Promise.all([getSummary(), loadRules()]);
  const lastIngestedAt = 'lastIngestedAt' in summary ? summary.lastIngestedAt : null;

  const severityLabels: Record<string, string> = {
    critical: t('wiSeverity.critical'),
    high: t('wiSeverity.high'),
    medium: t('wiSeverity.medium'),
    low: t('wiSeverity.low'),
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">{t('wiDetection.title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('wiDetection.subtitle')}</p>
      </header>
      <DetectionActions lastIngestedAt={lastIngestedAt} />

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('wiDetectionRules.title')}
          </h2>
        </header>
        {rules == null || rules.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiDetectionRules.emptyHint')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3 font-medium">{t('wiDetectionRules.headerKey')}</th>
                  <th className="py-2 pr-3 font-medium">{t('wiDetectionRules.headerName')}</th>
                  <th className="py-2 pr-3 font-medium">{t('wiDetectionRules.headerSeverity')}</th>
                  <th className="py-2 pr-3 font-medium">{t('wiDetectionRules.headerEnabled')}</th>
                  <th className="py-2 font-medium">{t('wiDetectionRules.headerParams')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rules.map((r) => {
                  const i18nName = t(`wiRules.${r.ruleKey}`, r.displayName);
                  const displayName = i18nName === `wiRules.${r.ruleKey}` ? r.displayName : i18nName;
                  const sevLabel = severityLabels[r.severity.toLowerCase()] ?? r.severity;
                  return (
                    <tr key={r.ruleKey} className="align-top">
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {r.ruleKey}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-800 dark:text-slate-200">{displayName}</td>
                      <td className="py-2.5 pr-3">
                        <SeverityBadge severity={r.severity} label={sevLabel} compact />
                      </td>
                      <td className="py-2.5 pr-3">
                        {r.enabled ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            title={t('wiDetectionRules.enabledBadge')}
                          >
                            <span aria-hidden="true">✓</span>
                            <span>{t('wiDetectionRules.enabledBadge')}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            title={t('wiDetectionRules.deferredBadge')}
                          >
                            {t('wiDetectionRules.deferredBadge')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all max-w-[480px]">
                        {formatParams(r.paramsJson)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
