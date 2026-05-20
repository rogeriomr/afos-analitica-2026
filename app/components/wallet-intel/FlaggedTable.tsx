'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { WalletAddress } from './WalletAddress';
import { ScoreGauge } from './ScoreGauge';
import { SeverityBadge } from './SeverityBadge';
import { RelativeTime } from './RelativeTime';

type Severity = 'critical' | 'high' | 'medium' | 'low';
const SEV: Severity[] = ['critical', 'high', 'medium', 'low'];

interface TopFlag {
  ruleKey: string;
  severity: string;
  triggeredAt: string;
  marketConditionId?: string;
}

interface FlaggedWallet {
  proxyAddress: string;
  username?: string;
  totalScore: number;
  flagCount: number;
  highSeverityCount: number;
  lastComputedAt: string | null;
  topFlags: TopFlag[];
}

interface ApiResponse {
  wallets: FlaggedWallet[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 25;

export function FlaggedTable() {
  const { t, locale } = useTranslation();
  const [selected, setSelected] = useState<Set<Severity>>(new Set());
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sevCsv = useMemo(() => Array.from(selected).join(','), [selected]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (sevCsv) params.set('severity', sevCsv);
      const res = await fetch(`/api/wallet-intel/flagged?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }, [offset, sevCsv]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  function toggleSeverity(s: Severity) {
    setOffset(0);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function clearFilters() {
    setOffset(0);
    setSelected(new Set());
  }

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sevColor: Record<Severity, string> = {
    critical: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950/40 dark:text-red-300',
    high: 'bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-300',
    medium: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-300',
    low: 'bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-950/40 dark:text-blue-300',
  };

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 flex items-center gap-2 flex-wrap"
        aria-label={t('wiFlagged.filterBySeverity')}
      >
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mr-1">
          {t('wiFlagged.filterBySeverity')}:
        </span>
        {SEV.map((s) => {
          const active = selected.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleSeverity(s)}
              aria-pressed={active}
              className={`inline-flex items-center px-3 py-1 rounded-full ring-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                active ? sevColor[s] : 'bg-transparent text-slate-500 ring-slate-300 dark:ring-slate-700 hover:ring-primary'
              }`}
            >
              {t(`wiSeverity.${s}`)}
            </button>
          );
        })}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs text-slate-500 hover:text-primary underline-offset-2 hover:underline"
          >
            {t('wi.clearFilters')}
          </button>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4 text-sm flex items-center justify-between gap-3">
          <span>{t('wi.error')}: {error}</span>
          <button onClick={() => void fetchPage()} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
            {t('wi.retry')}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left">
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold">{t('wiFlagged.colAddress')}</th>
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold">{t('wiFlagged.colUsername')}</th>
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold w-[180px]">{t('wiFlagged.colScore')}</th>
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold text-right">{t('wiFlagged.colFlags')}</th>
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold">{t('wiFlagged.colTopFlags')}</th>
                <th scope="col" className="px-3 sm:px-4 py-2.5 font-semibold">{t('wiFlagged.colLastComputed')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && !data ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">{t('wi.loading')}</td></tr>
              ) : data && data.wallets.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">{t('wiFlagged.noResults')}</td></tr>
              ) : (
                data?.wallets.map((w) => {
                  const href = `/${locale}/wallet-intel/wallet/${w.proxyAddress}`;
                  return (
                    <tr
                      key={w.proxyAddress}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-3 sm:px-4 py-2.5 whitespace-nowrap">
                        <WalletAddress address={w.proxyAddress} href={href} />
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 text-slate-700 dark:text-slate-300">
                        {w.username ? (
                          <Link href={href} className="hover:text-primary hover:underline">{w.username}</Link>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">{t('wiFlagged.noUsername')}</span>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 py-2.5">
                        <ScoreGauge score={w.totalScore} variant="compact" />
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {w.flagCount}
                      </td>
                      <td className="px-3 sm:px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {w.topFlags.slice(0, 3).map((f, i) => (
                            <SeverityBadge
                              key={`${f.ruleKey}-${i}`}
                              severity={f.severity}
                              label={t(`wiRules.${f.ruleKey}`, f.ruleKey)}
                              compact
                              title={t(`wiRules.${f.ruleKey}_desc`, '')}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                        <RelativeTime iso={w.lastComputedAt} fallback="—" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && total > 0 && (
        <nav className="flex items-center justify-between gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-400" aria-label="pagination">
          <span>
            {t('wiFlagged.showing')
              .replace('{start}', String(start))
              .replace('{end}', String(end))
              .replace('{total}', String(total))}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary hover:text-primary transition-colors"
            >
              ← {t('wiFlagged.previous')}
            </button>
            <span className="font-mono">
              {t('wiFlagged.page')} {page} {t('wiFlagged.of')} {lastPage}
            </span>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary hover:text-primary transition-colors"
            >
              {t('wiFlagged.next')} →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
