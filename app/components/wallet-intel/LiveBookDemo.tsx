'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n/context';
import { OrderBookDepthChart } from './OrderBookDepthChart';
import type { LiquidityImpactData } from './LiquidityImpactCard';

/**
 * One demo candidate displayed in the live-book toggle. `initialData` is
 * server-fetched so the first paint is instant; afterwards the client
 * refreshes on its own interval against the same /orderbook endpoint.
 */
export interface DemoCandidate {
  /** Stable React key. */
  id: string;
  /** Short button label (e.g. "Lula"). */
  label: string;
  /** Secondary line (e.g. "favorito · ~45% YES"). */
  sublabel: string;
  /** Polymarket conditionId — 0x + 64 hex chars. */
  conditionId: string;
  /** Market question — surfaced under the chart for context. */
  question: string;
  /** Initial orderbook payload (server-fetched). null when Polymarket was unreachable. */
  initialData: LiquidityImpactData | null;
}

interface Props {
  candidates: DemoCandidate[];
  /** Polling cadence. Default 60s — balances freshness vs Polymarket rate limits. */
  refreshIntervalMs?: number;
}

function formatRelativeSeconds(seconds: number, t: (k: string) => string): string {
  if (seconds < 5) return t('wiAntiManip.liveJustNow');
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export function LiveBookDemo({ candidates, refreshIntervalMs = 60_000 }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(candidates[0]?.id ?? '');
  const [data, setData] = useState<Record<string, LiquidityImpactData | null>>(() => {
    const out: Record<string, LiquidityImpactData | null> = {};
    for (const c of candidates) out[c.id] = c.initialData;
    return out;
  });
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = candidates.find((c) => c.id === activeId) ?? candidates[0];
  const activeData = active ? data[active.id] : null;

  // ── Single 1Hz ticker that drives both "updated Xs ago" + "next in Ys" ──
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        candidates.map((c) =>
          fetch(`/api/wallet-intel/market/${c.conditionId}/orderbook`, {
            cache: 'no-store',
          }).then(async (r) => (r.ok ? ((await r.json()) as LiquidityImpactData) : null)),
        ),
      );
      const next: Record<string, LiquidityImpactData | null> = { ...data };
      let anyFresh = false;
      candidates.forEach((c, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value) {
          next[c.id] = r.value;
          anyFresh = true;
        }
        // On settled-but-null OR rejected, keep the old data instead of
        // wiping the chart — transient Polymarket failures shouldn't make
        // the UI appear broken.
      });
      setData(next);
      if (anyFresh) setLastRefresh(Date.now());
      else setError(t('wiAntiManip.liveRefreshFailed'));
    } catch (err) {
      setError(t('wiAntiManip.liveRefreshFailed'));
      // eslint-disable-next-line no-console
      console.warn('[live-book] refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [candidates, data, refreshing, t]);

  // ── Auto-refresh loop ──
  useEffect(() => {
    const id = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refresh, refreshIntervalMs]);

  const secondsSince = Math.max(0, Math.floor((now - lastRefresh) / 1000));
  const secondsUntilNext = Math.max(0, Math.ceil(refreshIntervalMs / 1000) - secondsSince);

  const noLiveData = useMemo(
    () => candidates.every((c) => data[c.id] == null),
    [candidates, data],
  );

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header: toggle pills + status strip */}
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {candidates.map((c) => {
            const isActive = c.id === active?.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                role="tab"
                aria-selected={isActive}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span>{c.label}</span>
                <span
                  className={`ml-1 text-[10px] font-mono ${isActive ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}
                >
                  · {c.sublabel}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          {refreshing ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t('wiAntiManip.liveRefreshing')}
            </span>
          ) : (
            <span>
              {t('wiAntiManip.liveUpdated')}{' '}
              <span className="text-slate-700 dark:text-slate-300">{formatRelativeSeconds(secondsSince, t)}</span>
              <span className="text-slate-400 dark:text-slate-600"> · </span>
              {t('wiAntiManip.liveNextIn')}{' '}
              <span className="text-slate-700 dark:text-slate-300">{secondsUntilNext}s</span>
            </span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={t('wiAntiManip.liveRefreshNow')}
            title={t('wiAntiManip.liveRefreshNow')}
            className="ml-1 text-slate-500 hover:text-primary disabled:opacity-50 rounded p-0.5"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Error banner — only when both candidates failed to refresh */}
      {error && noLiveData && (
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300">
          {error}
        </div>
      )}

      {/* Chart body */}
      <div className="p-4">
        {activeData ? (
          <OrderBookDepthChart
            yesBook={activeData.yesBook}
            noBook={activeData.noBook}
            marketQuestion={active?.question ?? null}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
            {t('wiAntiManip.liveUnavailable')}
          </p>
        )}
      </div>
    </div>
  );
}
