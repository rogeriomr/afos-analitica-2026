'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { ELECTION_REGISTRY } from '../../lib/polymarket/country-market-map';
import { FlagCard } from './FlagCard';
import { RelativeTime } from './RelativeTime';

// Set of slugs we explicitly track for AFOS electoral risk intel. Wallets often
// trade on dozens of unrelated markets; surfacing the AFOS-relevant subset first
// lets analysts spot political-market behavior without scrolling.
const AFOS_TRACKED_SLUGS = new Set(ELECTION_REGISTRY.filter((e) => e.enabled).map((e) => e.slug));

interface Position {
  marketConditionId: string;
  marketSlug: string;
  outcomeIndex: number;
  outcomeName: string;
  size: number;
  avgPrice: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPercent: number | null;
  snapshotDate: string;
}

interface Trade {
  marketConditionId: string;
  marketSlug: string;
  side: string;
  outcomeIndex: number | null;
  size: number;
  price: number;
  valueUsd: number;
  transactionHash: string;
  tradeTimestamp: string;
}

interface Flag {
  ruleKey: string;
  severity: string;
  marketConditionId: string | null;
  evidence: unknown;
  explanation: string;
  triggeredAt: string;
}

interface Profile {
  pseudonym: string | null;
  username: string | null;
  xUsername: string | null;
  profileImageUrl: string | null;
  verifiedBadge: boolean;
  lastFetchedAt: string;
}

/**
 * Server-serialised counterpart of {@link PositionBuildSession} in queries.ts —
 * Date fields flattened to ISO strings so they can cross the SSR→client boundary.
 */
export interface SerializablePositionBuildSession {
  marketConditionId: string;
  marketSlug: string;
  outcomeIndex: number | null;
  outcomeName: string | null;
  side: 'BUY' | 'SELL';
  sessionStart: string;
  sessionEnd: string;
  durationMs: number;
  tradeCount: number;
  totalVolumeUsd: number;
  priceStart: number | null;
  priceEnd: number | null;
  probabilityDeltaPct: number | null;
}

/** Plain-object map (conditionId → { outcomeIndex string → outcomeName }). */
export type OutcomesByCondition = Record<string, Record<string, string>>;

interface Props {
  flags: Flag[];
  positions: Position[];
  trades: Trade[];
  profile: Profile | null;
  positionBuilds: SerializablePositionBuildSession[];
  outcomesByConditionId: OutcomesByCondition;
}

type TabKey = 'flags' | 'positions' | 'trades' | 'profile' | 'positionBuilds';

type PbSortKey = 'sessionStart' | 'durationMs' | 'tradeCount' | 'totalVolumeUsd' | 'probabilityDeltaPct';
type SortDir = 'asc' | 'desc';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

/** USD with k/M abbreviations — used by the position-build volume column. */
function formatUsdShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 1 : 2)}k`;
  return `$${n.toFixed(0)}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  if (totalMin < 1) return '<1min';
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}min`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
}

function pnlClass(n: number): string {
  if (n > 0) return 'text-emerald-600 dark:text-emerald-300';
  if (n < 0) return 'text-red-600 dark:text-red-300';
  return 'text-slate-600 dark:text-slate-400';
}

/**
 * Format the probability delta as a colored chip.
 * Threshold: |delta| > 0.5pp gates the color, otherwise neutral slate.
 */
function ProbabilityChip({
  priceStart,
  priceEnd,
  deltaPct,
  noDataLabel,
}: {
  priceStart: number | null;
  priceEnd: number | null;
  deltaPct: number | null;
  noDataLabel: string;
}) {
  if (priceStart == null || priceEnd == null || deltaPct == null) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {noDataLabel}
      </span>
    );
  }
  let tone = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  if (deltaPct > 0.5) tone = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
  else if (deltaPct < -0.5) tone = 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300';

  const sign = deltaPct > 0 ? '+' : '';
  const startPct = (priceStart * 100).toFixed(0);
  const endPct = (priceEnd * 100).toFixed(0);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${tone}`}>
      <span>{sign}{deltaPct.toFixed(1)}pp</span>
      <span className="font-mono text-[10px] opacity-80">({startPct}% → {endPct}%)</span>
    </span>
  );
}

/**
 * Plain HTML table for a slice of positions. Pulled out so we can render two
 * sections (AFOS-tracked vs other) without duplicating the table markup.
 */
function PositionsTable({
  positions,
  t,
}: {
  positions: Position[];
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colMarket')}</th>
            <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colOutcome')}</th>
            <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colSize')}</th>
            <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colAvgPrice')}</th>
            <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colCurrentValue')}</th>
            <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colPnl')}</th>
            <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colPnlPercent')}</th>
            <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colSnapshot')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
          {positions.map((p, i) => (
            <tr key={`${p.marketConditionId}-${p.outcomeIndex}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <td className="px-3 py-2 truncate max-w-[260px] font-sans" title={p.marketSlug}>{p.marketSlug || p.marketConditionId.slice(0, 14) + '...'}</td>
              <td className="px-3 py-2 font-sans">{p.outcomeName} <span className="text-slate-400">({p.outcomeIndex})</span></td>
              <td className="px-3 py-2 text-right">{p.size.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{p.avgPrice.toFixed(3)}</td>
              <td className="px-3 py-2 text-right">${formatUsd(p.currentValueUsd)}</td>
              <td className={`px-3 py-2 text-right font-semibold ${pnlClass(p.pnlUsd)}`}>{p.pnlUsd >= 0 ? '+' : ''}${formatUsd(p.pnlUsd)}</td>
              <td className={`px-3 py-2 text-right ${pnlClass(p.pnlUsd)}`}>{p.pnlPercent == null ? '—' : `${p.pnlPercent.toFixed(1)}%`}</td>
              <td className="px-3 py-2 font-sans text-slate-500">{p.snapshotDate.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WalletDetailTabs({
  flags,
  positions,
  trades,
  profile,
  positionBuilds,
  outcomesByConditionId,
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>(flags.length > 0 ? 'flags' : 'positions');

  // Split positions into AFOS-tracked vs everything-else so the analyst sees
  // political-market activity first.
  const { afosPositions, otherPositions } = useMemo(() => {
    const afos: Position[] = [];
    const other: Position[] = [];
    for (const p of positions) {
      if (AFOS_TRACKED_SLUGS.has(p.marketSlug)) afos.push(p);
      else other.push(p);
    }
    return { afosPositions: afos, otherPositions: other };
  }, [positions]);

  // Position-building sort state — default newest first.
  const [pbSort, setPbSort] = useState<{ key: PbSortKey; dir: SortDir }>({
    key: 'sessionStart',
    dir: 'desc',
  });

  const sortedPositionBuilds = useMemo(() => {
    const arr = positionBuilds.slice();
    const { key, dir } = pbSort;
    const sign = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av: number = key === 'sessionStart' ? new Date(a.sessionStart).getTime() : (a[key] ?? -Infinity);
      const bv: number = key === 'sessionStart' ? new Date(b.sessionStart).getTime() : (b[key] ?? -Infinity);
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return 0;
    });
    return arr;
  }, [positionBuilds, pbSort]);

  // If more than half of the sessions have no price data we surface a hint
  // banner so the user understands why the chips are mostly "—".
  const missingPriceShare = positionBuilds.length === 0
    ? 0
    : positionBuilds.filter((s) => s.priceStart == null || s.priceEnd == null).length / positionBuilds.length;
  const showNoPriceBanner = positionBuilds.length > 0 && missingPriceShare > 0.5;

  function setPbSortFor(key: PbSortKey) {
    setPbSort((prev) => prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }

  function pbSortIndicator(key: PbSortKey) {
    if (pbSort.key !== key) return '';
    return pbSort.dir === 'desc' ? ' ↓' : ' ↑';
  }

  /** Resolve an outcome name from the parent-passed map; returns null on miss. */
  function outcomeNameFor(conditionId: string, outcomeIndex: number | null): string | null {
    if (outcomeIndex == null) return null;
    const bucket = outcomesByConditionId[conditionId];
    if (!bucket) return null;
    return bucket[String(outcomeIndex)] ?? null;
  }

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'flags', label: t('wiWallet.tabFlags'), count: flags.length },
    { key: 'positions', label: t('wiWallet.tabPositions'), count: positions.length },
    { key: 'trades', label: t('wiWallet.tabTrades'), count: trades.length },
    { key: 'positionBuilds', label: t('wiWallet.tabPositionBuilds'), count: positionBuilds.length },
    { key: 'profile', label: t('wiWallet.tabProfile') },
  ];

  return (
    <div>
      <div role="tablist" className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tabDef) => {
          const active = tab === tabDef.key;
          return (
            <button
              key={tabDef.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(tabDef.key)}
              className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
                active
                  ? 'text-primary border-primary'
                  : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-primary'
              }`}
            >
              {tabDef.label}
              {tabDef.count != null && (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-mono ${active ? 'bg-primary/10' : 'bg-slate-200 dark:bg-slate-800'}`}>
                  {tabDef.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="pt-5">
        {tab === 'flags' && (
          flags.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiWallet.flagsEmpty')}</p>
          ) : (
            <div className="grid gap-3">
              {flags.map((f, i) => (
                <FlagCard
                  key={`${f.ruleKey}-${f.triggeredAt}-${i}`}
                  ruleKey={f.ruleKey}
                  severity={f.severity}
                  marketConditionId={f.marketConditionId}
                  evidence={f.evidence}
                  explanation={f.explanation}
                  triggeredAt={f.triggeredAt}
                />
              ))}
            </div>
          )
        )}

        {tab === 'positions' && (
          positions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiWallet.positionsEmpty')}</p>
          ) : (
            <div className="space-y-5">
              {afosPositions.length > 0 && (
                <section>
                  <header className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {t('wiWallet.positionsAfosSection')}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {afosPositions.length}
                    </span>
                  </header>
                  <PositionsTable positions={afosPositions} t={t} />
                </section>
              )}
              {otherPositions.length > 0 && (
                <section>
                  <header className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {t('wiWallet.positionsOtherSection')}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {otherPositions.length}
                    </span>
                  </header>
                  <PositionsTable positions={otherPositions} t={t} />
                </section>
              )}
            </div>
          )
        )}

        {tab === 'trades' && (
          trades.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiWallet.tradesEmpty')}</p>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colTime')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colMarket')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colOutcome')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colSide')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colSize')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colPrice')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colValue')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colTx')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
                  {trades.map((tr, i) => {
                    const resolvedName = outcomeNameFor(tr.marketConditionId, tr.outcomeIndex);
                    return (
                      <tr key={`${tr.transactionHash}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-sans"><RelativeTime iso={tr.tradeTimestamp} className="text-slate-600 dark:text-slate-400" /></td>
                        <td className="px-3 py-2 font-sans truncate max-w-[220px]" title={tr.marketSlug}>{tr.marketSlug || tr.marketConditionId.slice(0, 14) + '...'}</td>
                        <td className="px-3 py-2 font-sans">
                          {resolvedName ? (
                            <span>{resolvedName}{tr.outcomeIndex != null && <span className="text-slate-400"> ({tr.outcomeIndex})</span>}</span>
                          ) : (
                            <span className="text-slate-500">{tr.outcomeIndex == null ? '—' : `Outcome ${tr.outcomeIndex}`}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-sans">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            tr.side.toUpperCase() === 'BUY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          }`}>
                            {tr.side}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{tr.size.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{tr.price.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right">${formatUsd(tr.valueUsd)}</td>
                        <td className="px-3 py-2">
                          <a
                            href={`https://polygonscan.com/tx/${tr.transactionHash}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-primary hover:underline font-mono"
                            title={t('wi.polygonscan')}
                          >
                            {tr.transactionHash.slice(0, 8)}...
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'positionBuilds' && (
          positionBuilds.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiWallet.pbEmpty')}</p>
          ) : (
            <div className="space-y-3">
              {showNoPriceBanner && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {t('wiWallet.pbNoPriceHistory')}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">{t('wiWallet.pbMarket')}</th>
                      <th className="px-3 py-2.5 font-semibold">{t('wiWallet.pbOutcome')}</th>
                      <th className="px-3 py-2.5 font-semibold">{t('wiWallet.pbSide')}</th>
                      <th className="px-3 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => setPbSortFor('sessionStart')}
                          className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-primary"
                        >
                          {t('wiWallet.pbStart')}{pbSortIndicator('sessionStart')}
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => setPbSortFor('durationMs')}
                          className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-primary"
                        >
                          {t('wiWallet.pbDuration')}{pbSortIndicator('durationMs')}
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => setPbSortFor('tradeCount')}
                          className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-primary"
                        >
                          {t('wiWallet.pbTrades')}{pbSortIndicator('tradeCount')}
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => setPbSortFor('totalVolumeUsd')}
                          className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-primary"
                        >
                          {t('wiWallet.pbVolumeUsd')}{pbSortIndicator('totalVolumeUsd')}
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => setPbSortFor('probabilityDeltaPct')}
                          className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-primary"
                        >
                          {t('wiWallet.pbProbability')}{pbSortIndicator('probabilityDeltaPct')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
                    {sortedPositionBuilds.map((s, i) => {
                      const resolvedName = s.outcomeName ?? outcomeNameFor(s.marketConditionId, s.outcomeIndex);
                      return (
                        <tr
                          key={`${s.marketConditionId}-${s.outcomeIndex ?? 'na'}-${s.side}-${s.sessionStart}-${i}`}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2 font-sans truncate max-w-[220px]" title={s.marketSlug}>
                            {s.marketSlug || s.marketConditionId.slice(0, 14) + '...'}
                          </td>
                          <td className="px-3 py-2 font-sans">
                            {resolvedName ? (
                              <span>{resolvedName}{s.outcomeIndex != null && <span className="text-slate-400"> ({s.outcomeIndex})</span>}</span>
                            ) : (
                              <span className="text-slate-500">{s.outcomeIndex == null ? '—' : `Outcome ${s.outcomeIndex}`}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-sans">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              s.side === 'BUY'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                            }`}>
                              {s.side}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-sans">
                            <RelativeTime iso={s.sessionStart} className="text-slate-600 dark:text-slate-400" />
                          </td>
                          <td className="px-3 py-2 font-sans">{formatDuration(s.durationMs)}</td>
                          <td className="px-3 py-2 text-right">{s.tradeCount}</td>
                          <td className="px-3 py-2 text-right">{formatUsdShort(s.totalVolumeUsd)}</td>
                          <td className="px-3 py-2">
                            <ProbabilityChip
                              priceStart={s.priceStart}
                              priceEnd={s.priceEnd}
                              deltaPct={s.probabilityDeltaPct}
                              noDataLabel={t('wiWallet.pbDeltaNoData')}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        {tab === 'profile' && (
          !profile ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiWallet.profileEmpty')}</p>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                {profile.profileImageUrl && (
                  <img
                    src={profile.profileImageUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="rounded-full ring-2 ring-slate-200 dark:ring-slate-700"
                    style={{ width: 48, height: 48, objectFit: 'cover' }}
                  />
                )}
                <div className="min-w-0">
                  {profile.username ? (
                    <a
                      href={`https://polymarket.com/profile/${profile.username}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-lg font-semibold text-primary hover:underline"
                    >
                      {profile.username}
                    </a>
                  ) : (
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">—</p>
                  )}
                  {profile.pseudonym && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{profile.pseudonym}</p>
                  )}
                </div>
                {profile.verifiedBadge && (
                  <span className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 text-[10px] font-semibold uppercase">
                    ✓ {t('wiWallet.profileVerified')}
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">{t('wiWallet.profilePseudonym')}</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{profile.pseudonym ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">{t('wiWallet.profileXUsername')}</dt>
                  <dd>
                    {profile.xUsername ? (
                      <a
                        href={`https://x.com/${profile.xUsername.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline"
                      >
                        @{profile.xUsername.replace(/^@/, '')}
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[11px] uppercase tracking-wider text-slate-500">{t('wiWallet.profileLastFetched')}</dt>
                  <dd><RelativeTime iso={profile.lastFetchedAt} className="text-slate-700 dark:text-slate-300" /></dd>
                </div>
              </dl>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// Re-export utility for the page header to share PnL coloring.
export { formatUsd, pnlClass };
