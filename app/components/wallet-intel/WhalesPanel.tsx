'use client';

/**
 * Whales panel — top-20 wallets by traded volume for a market, with a
 * client-side toggle for the {24h, 7d, 30d, all} timeframe. Initial data
 * is rendered SSR (passed in as `initialData`) so the first paint is
 * instant; later clicks refetch via `/api/wallet-intel/market/[cid]/whales`.
 *
 * Also surfaces each whale's % of observed supply on outcome 0 ("YES")
 * and outcome 1 ("NO") at the latest holder snapshot, when available.
 * Multi-outcome markets are not supported by these two columns yet —
 * for >2 outcomes the yes/no fields stay null and render as "—".
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { WalletAddress } from './WalletAddress';
import { ScoreGauge } from './ScoreGauge';
import type { WhaleEntry, WhalesTimeframe } from '../../lib/wallet-intel/queries';

interface ApiResponse {
  conditionId: string;
  timeframe: WhalesTimeframe;
  whales: WhaleEntry[];
}

interface Props {
  conditionId: string;
  locale: string;
  initialData: ApiResponse;
}

const TIMEFRAMES: ReadonlyArray<WhalesTimeframe> = ['24h', '7d', '30d', 'all'];

function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function tfLabelKey(tf: WhalesTimeframe): string {
  switch (tf) {
    case '24h':
      return 'wiMarket.tf24h';
    case '7d':
      return 'wiMarket.tf7d';
    case '30d':
      return 'wiMarket.tf30d';
    case 'all':
      return 'wiMarket.tfAll';
  }
}

function applyPlaceholders(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

function SupplyChip({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  if (pct <= 0) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  // Color ramp on share: ≥10% green-bold, ≥3% green-normal, else slate.
  const tone =
    pct >= 10
      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold'
      : pct >= 3
        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono tabular-nums ${tone}`}
    >
      {pct.toFixed(1)}%
    </span>
  );
}

export function WhalesPanel({ conditionId, locale, initialData }: Props) {
  const { t } = useTranslation();
  const [timeframe, setTimeframe] = useState<WhalesTimeframe>(initialData.timeframe);
  const [data, setData] = useState<ApiResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeframe = useCallback(
    async (tf: WhalesTimeframe) => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/wallet-intel/market/${conditionId}/whales?timeframe=${tf}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.message || `HTTP ${res.status}`);
        }
        const next = (await res.json()) as ApiResponse;
        setData(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        setLoading(false);
      }
    },
    [conditionId],
  );

  useEffect(() => {
    // Skip the initial render — initialData already covers it.
    if (timeframe === initialData.timeframe && data === initialData) return;
    void fetchTimeframe(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const tfLabel = t(tfLabelKey(timeframe));
  const panelTitle = applyPlaceholders(t('wiMarket.whalesPanelTitle'), { timeframe: tfLabel });

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-start sm:items-center gap-3 flex-wrap justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{panelTitle}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('wiMarket.whalesSubtitle')}</p>
        </div>
        <div
          role="group"
          aria-label={t('wiMarket.tfHeader')}
          className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-0.5"
        >
          {TIMEFRAMES.map((tf) => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                aria-pressed={active}
                className={
                  'px-2.5 py-1 text-xs font-medium rounded transition-colors ' +
                  (active
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200')
                }
              >
                {t(tfLabelKey(tf))}
              </button>
            );
          })}
        </div>
      </header>

      {error && (
        <div className="px-4 sm:px-5 py-3 border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>
            {t('wi.error')}: {error}
          </span>
          <button
            type="button"
            onClick={() => void fetchTimeframe(timeframe)}
            className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
          >
            {t('wi.retry')}
          </button>
        </div>
      )}

      {data.whales.length === 0 ? (
        <p className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
          {t('wiMarket.whalesEmpty')}
        </p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-50' : ''}`}>
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
                <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.whaleYesPct')}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.whaleNoPct')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.whales.map((w, i) => (
                <tr key={w.proxyAddress} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-500 font-mono tabular-nums text-xs">{i + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <WalletAddress
                      address={w.proxyAddress}
                      href={`/${locale}/wallet-intel/wallet/${w.proxyAddress}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {w.username ?? <span className="text-slate-400 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    ${formatNumber(w.totalValueUsd)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {formatNumber(w.tradeCount)}
                  </td>
                  <td className="px-3 py-2">
                    <ScoreGauge score={w.totalScore} variant="compact" emptyLabel="—" />
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                    {w.flagCount ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SupplyChip pct={w.yesSupplyPct} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SupplyChip pct={w.noSupplyPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
