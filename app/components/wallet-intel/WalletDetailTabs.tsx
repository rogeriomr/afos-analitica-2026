'use client';

import { useState } from 'react';
import { useTranslation } from '../../i18n/context';
import { FlagCard } from './FlagCard';
import { RelativeTime } from './RelativeTime';
import { WalletAddress } from './WalletAddress';

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

interface Props {
  flags: Flag[];
  positions: Position[];
  trades: Trade[];
  profile: Profile | null;
}

type TabKey = 'flags' | 'positions' | 'trades' | 'profile';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function pnlClass(n: number): string {
  if (n > 0) return 'text-emerald-600 dark:text-emerald-300';
  if (n < 0) return 'text-red-600 dark:text-red-300';
  return 'text-slate-600 dark:text-slate-400';
}

export function WalletDetailTabs({ flags, positions, trades, profile }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>(flags.length > 0 ? 'flags' : 'positions');

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'flags', label: t('wiWallet.tabFlags'), count: flags.length },
    { key: 'positions', label: t('wiWallet.tabPositions'), count: positions.length },
    { key: 'trades', label: t('wiWallet.tabTrades'), count: trades.length },
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
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colSide')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colSize')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colPrice')}</th>
                    <th className="px-3 py-2.5 font-semibold text-right">{t('wiWallet.colValue')}</th>
                    <th className="px-3 py-2.5 font-semibold">{t('wiWallet.colTx')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
                  {trades.map((tr, i) => (
                    <tr key={`${tr.transactionHash}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-sans"><RelativeTime iso={tr.tradeTimestamp} className="text-slate-600 dark:text-slate-400" /></td>
                      <td className="px-3 py-2 font-sans truncate max-w-[220px]" title={tr.marketSlug}>{tr.marketSlug || tr.marketConditionId.slice(0, 14) + '...'}</td>
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
                  ))}
                </tbody>
              </table>
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
