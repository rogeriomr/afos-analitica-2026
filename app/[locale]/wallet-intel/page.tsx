import Link from 'next/link';
import { getMessages } from '../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../lib/i18n/config';
import { getSummary } from '../../lib/wallet-intel/queries';
import { RelativeTime } from '../../components/wallet-intel/RelativeTime';
import { MarketChip } from '../../components/wallet-intel/MarketChip';
import { ELECTION_REGISTRY } from '../../lib/polymarket/country-market-map';

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

function StatCard({
  label,
  value,
  hint,
  accent = 'primary',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: 'primary' | 'red' | 'orange' | 'slate';
}) {
  const accentMap: Record<string, string> = {
    primary: 'text-primary',
    red: 'text-red-600 dark:text-red-300',
    orange: 'text-orange-600 dark:text-orange-300',
    slate: 'text-slate-800 dark:text-slate-200',
  };
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accentMap[accent]}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

function DistributionBar({
  distribution,
  emptyLabel,
}: {
  distribution: { critical: number; high: number; medium: number; low: number };
  emptyLabel: string;
}) {
  const total = distribution.critical + distribution.high + distribution.medium + distribution.low;
  if (total === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>;
  }
  const segments: Array<{ key: string; count: number; color: string }> = [
    { key: 'critical', count: distribution.critical, color: 'bg-red-500' },
    { key: 'high', count: distribution.high, color: 'bg-orange-500' },
    { key: 'medium', count: distribution.medium, color: 'bg-amber-400' },
    { key: 'low', count: distribution.low, color: 'bg-blue-400' },
  ];
  return (
    <div>
      <div
        className="w-full h-3 rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800"
        role="img"
        aria-label={`${total} wallets`}
      >
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className={`${s.color} h-full`}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.key}: ${s.count}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} aria-hidden="true" />
            <span className="text-slate-600 dark:text-slate-400 capitalize">{s.key}</span>
            <span className="ml-auto font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SummaryPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  const result = await getSummary();
  const hasError = 'error' in result;

  const cards = !hasError ? (
    <>
      <StatCard label={t('wiSummary.totalWallets')} value={result.totalWalletsTracked.toLocaleString()} hint={t('wiSummary.totalWalletsHint')} accent="primary" />
      <StatCard label={t('wiSummary.flaggedWallets')} value={result.flaggedWalletsCount.toLocaleString()} hint={t('wiSummary.flaggedWalletsHint')} accent="orange" />
      <StatCard label={t('wiSummary.criticalHigh')} value={(result.distribution.critical + result.distribution.high).toLocaleString()} hint={t('wiSummary.criticalHighHint')} accent="red" />
      <StatCard
        label={t('wiSummary.lastIngestedAt')}
        value={result.lastIngestedAt ? <RelativeTime iso={result.lastIngestedAt} /> : t('wiSummary.neverIngested')}
        hint={t('wiSummary.lastIngestedAtHint')}
        accent="slate"
      />
    </>
  ) : null;

  // Build a slug → registry entry index for the top-markets list.
  const entryBySlug = new Map(ELECTION_REGISTRY.map((e) => [e.slug, e]));

  const showEmpty =
    !hasError && result.totalWalletsTracked === 0 && result.flaggedWalletsCount === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">{t('wiSummary.title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('wiSummary.subtitle')}</p>
      </header>

      {hasError ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4 text-sm">
          {t('wi.error')}: {result.error}
        </div>
      ) : showEmpty ? (
        <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{t('wiSummary.emptyState')}</p>
          <Link
            href={`/${locale}/wallet-intel/detection`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors"
          >
            {t('wiSummary.emptyStateAction')}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">{cards}</div>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <header className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiSummary.distributionTitle')}</h2>
            </header>
            <DistributionBar distribution={result.distribution} emptyLabel={t('wiSummary.distributionEmpty')} />
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <header className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiSummary.topMarketsTitle')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('wiSummary.topMarketsHint')}</p>
            </header>
            {result.topSuspiciousMarkets.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiSummary.topMarketsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {result.topSuspiciousMarkets.map((m) => {
                  const entry = entryBySlug.get(m.marketSlug);
                  const href = `/${locale}/wallet-intel/market/${m.marketConditionId}`;
                  return (
                    <li key={m.marketConditionId} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                      <Link href={href} className="flex items-center gap-3 min-w-0 group">
                        {entry ? (
                          <MarketChip
                            flagIso3={entry.iso3}
                            countryName={entry.countryName}
                            electionType={entry.electionType}
                            marketSlug={m.marketSlug}
                          />
                        ) : (
                          <span className="font-mono text-xs text-slate-700 dark:text-slate-300 truncate max-w-[260px]">{m.marketSlug || m.marketConditionId.slice(0, 12) + '...'}</span>
                        )}
                      </Link>
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                        {t('wiSummary.flagsCount').replace('{n}', String(m.flagCount))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
