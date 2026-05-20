import Link from 'next/link';
import { getMessages } from '../../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../../lib/i18n/config';
import { getMarketHolders, getMarketWhales } from '../../../../lib/wallet-intel/queries';
import { WalletAddress } from '../../../../components/wallet-intel/WalletAddress';
import { ConcentrationMeter } from '../../../../components/wallet-intel/ConcentrationMeter';
import { ScoreGauge } from '../../../../components/wallet-intel/ScoreGauge';
import { RelativeTime } from '../../../../components/wallet-intel/RelativeTime';
import { ELECTION_REGISTRY, getFlagPath } from '../../../../lib/polymarket/country-market-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONDITION_RE = /^0x[a-f0-9]{64}$/;

interface PageProps {
  params: Promise<{ locale: string; conditionId: string }>;
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

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export default async function MarketDetailPage({ params }: PageProps) {
  const { locale: rawLocale, conditionId: rawCid } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  const conditionId = (rawCid || '').toLowerCase();
  if (!CONDITION_RE.test(conditionId)) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-sm text-red-700 dark:text-red-300">
        Invalid conditionId
      </div>
    );
  }

  const [holders, whales] = await Promise.all([
    getMarketHolders(conditionId),
    getMarketWhales(conditionId),
  ]);

  if ('error' in holders) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-sm text-red-700 dark:text-red-300">
        {t('wi.error')}: {holders.error}
      </div>
    );
  }
  if ('notFound' in holders) {
    return (
      <div className="space-y-4">
        <Link href={`/${locale}/wallet-intel/markets`} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-primary">
          ← {t('wi.back')}
        </Link>
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-6 text-center">
          <h1 className="text-lg font-bold text-amber-800 dark:text-amber-300">{t('wiMarket.notFound')}</h1>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{t('wiMarket.notFoundDesc')}</p>
          <p className="mt-3 font-mono text-[11px] text-slate-500 break-all">{conditionId}</p>
        </div>
      </div>
    );
  }

  const slug = holders.marketSlug;
  const registryEntry = ELECTION_REGISTRY.find((e) => e.slug === slug);
  const whalesList = 'whales' in whales ? whales.whales : [];

  // Top 30 holders from the parsed list (already sorted desc).
  const topHolders = (holders.allHoldersSorted ?? []).slice(0, 30);

  return (
    <div className="space-y-5">
      <Link href={`/${locale}/wallet-intel/markets`} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-primary">
        ← {t('wi.back')}
      </Link>

      <header className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
        <div className="flex items-start gap-3 flex-wrap">
          {registryEntry && (
            <img
              src={getFlagPath(registryEntry.iso3)}
              alt=""
              width={28}
              height={20}
              className="rounded-sm object-cover flex-shrink-0"
              style={{ width: 28, height: 20 }}
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              {registryEntry ? `${registryEntry.countryName} — ${registryEntry.electionType}` : slug || conditionId.slice(0, 14) + '...'}
            </h1>
            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-500 break-all">{slug}</p>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              {t('wiMarket.snapshotAt')}{' '}
              <RelativeTime iso={holders.latestSnapshotAt} />{' '}
              · {t('wiMarket.totalHolders')}{' '}
              <span className="font-mono font-semibold">{holders.totalHolders.toLocaleString()}</span>
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <header className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiMarket.concentrationTitle')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('wiMarket.concentrationSubtitle')}</p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <ConcentrationMeter label={t('wiMarket.top5')} percent={holders.concentrationTop5Pct} />
          <ConcentrationMeter label={t('wiMarket.top10')} percent={holders.concentrationTop10Pct} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiMarket.holdersTitle')}</h2>
        </header>
        {topHolders.length === 0 ? (
          <p className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400">{t('wiMarket.holdersEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 font-semibold w-12">{t('wi.rank')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('wiFlagged.colAddress')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.colAmount')}</th>
                  <th className="px-3 py-2.5 font-semibold text-center">{t('wiMarket.colOutcomeIndex')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {topHolders.map((h, i) => (
                  <tr key={h.proxyAddress + i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500 font-mono tabular-nums text-xs">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <WalletAddress address={h.proxyAddress} href={`/${locale}/wallet-intel/wallet/${h.proxyAddress}`} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{formatNumber(h.amount)}</td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-slate-600 dark:text-slate-400">{h.outcomeIndex ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('wiMarket.whalesTitle')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('wiMarket.whalesSubtitle')}</p>
        </header>
        {whalesList.length === 0 ? (
          <p className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400">{t('wiMarket.whalesEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 font-semibold w-12">{t('wi.rank')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('wiFlagged.colAddress')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('wiFlagged.colUsername')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.colVolume30d')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.colTradeCount')}</th>
                  <th className="px-3 py-2.5 font-semibold w-[160px]">{t('wiMarket.colScore')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.colFlagCount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {whalesList.map((w, i) => (
                  <tr key={w.proxyAddress} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500 font-mono tabular-nums text-xs">{i + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <WalletAddress address={w.proxyAddress} href={`/${locale}/wallet-intel/wallet/${w.proxyAddress}`} />
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{w.username ?? <span className="text-slate-400 dark:text-slate-600">—</span>}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">${formatNumber(w.totalValueUsd30d)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{w.tradeCount30d.toLocaleString()}</td>
                    <td className="px-3 py-2"><ScoreGauge score={w.totalScore} variant="compact" emptyLabel="—" /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{w.flagCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
