'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '../../i18n/context';
import { WalletAddress } from './WalletAddress';
import { ScoreGauge } from './ScoreGauge';
import { RelativeTime } from './RelativeTime';

type OrderBy = 'score' | 'volume' | 'pnl';
type TimePeriod = '7d' | '30d' | 'all';

interface Entry {
  proxyAddress: string;
  username?: string;
  totalScore: number | null;
  flagCount: number | null;
  totalVolume30d: number;
  currentPnlUsd: number;
}

interface ApiResponse {
  entries: Entry[];
  generatedAt: string;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function pnlClass(n: number): string {
  if (n > 0) return 'text-emerald-600 dark:text-emerald-300';
  if (n < 0) return 'text-red-600 dark:text-red-300';
  return 'text-slate-600 dark:text-slate-400';
}

export function LeaderboardClient() {
  const { t, locale } = useTranslation();
  const [orderBy, setOrderBy] = useState<OrderBy>('score');
  const [period, setPeriod] = useState<TimePeriod>('30d');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ orderBy, timePeriod: period });
      const res = await fetch(`/api/wallet-intel/leaderboard?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      setData((await res.json()) as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }, [orderBy, period]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-medium">{t('wiLeaderboard.orderBy')}:</span>
          <select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value as OrderBy)}
            className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="score">{t('wiLeaderboard.orderScore')}</option>
            <option value="volume">{t('wiLeaderboard.orderVolume')}</option>
            <option value="pnl">{t('wiLeaderboard.orderPnl')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-medium">{t('wiLeaderboard.timePeriod')}:</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as TimePeriod)}
            className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="7d">{t('wiLeaderboard.period7d')}</option>
            <option value="30d">{t('wiLeaderboard.period30d')}</option>
            <option value="all">{t('wiLeaderboard.periodAll')}</option>
          </select>
        </label>
        {data?.generatedAt && (
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-500">
            {t('wiLeaderboard.generatedAt')} <RelativeTime iso={data.generatedAt} />
          </span>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4 text-sm flex items-center justify-between gap-3">
          <span>{t('wi.error')}: {error}</span>
          <button onClick={() => void fetchData()} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
            {t('wi.retry')}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5 font-semibold w-12">{t('wiLeaderboard.colRank')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('wiLeaderboard.colAddress')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('wiLeaderboard.colUsername')}</th>
                <th className="px-3 py-2.5 font-semibold w-[160px]">{t('wiLeaderboard.colScore')}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t('wiLeaderboard.colFlags')}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t('wiLeaderboard.colVolume')}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t('wiLeaderboard.colPnl')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && !data ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">{t('wi.loading')}</td></tr>
              ) : data && data.entries.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">{t('wiLeaderboard.empty')}</td></tr>
              ) : (
                data?.entries.map((e, i) => {
                  const href = `/${locale}/wallet-intel/wallet/${e.proxyAddress}`;
                  return (
                    <tr key={e.proxyAddress} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-slate-500 font-mono tabular-nums text-xs">{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <WalletAddress address={e.proxyAddress} href={href} />
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                        {e.username ? (
                          <Link href={href} className="hover:text-primary hover:underline">{e.username}</Link>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><ScoreGauge score={e.totalScore} variant="compact" emptyLabel="—" /></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">{e.flagCount ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">${formatNumber(e.totalVolume30d)}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs font-semibold ${pnlClass(e.currentPnlUsd)}`}>
                        {e.currentPnlUsd > 0 ? '+' : ''}${formatNumber(e.currentPnlUsd)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
