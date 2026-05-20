import Link from 'next/link';
import { headers } from 'next/headers';
import { getMessages } from '../../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../../lib/i18n/config';
import { getMarketHolders, getMarketWhales } from '../../../../lib/wallet-intel/queries';
import {
  extractCandidateFromQuestion,
  getMarketOutcomes,
  getMarketQuestion,
} from '../../../../lib/wallet-intel/market-metadata';
import { WalletAddress } from '../../../../components/wallet-intel/WalletAddress';
import { ConcentrationMeter } from '../../../../components/wallet-intel/ConcentrationMeter';
import { RelativeTime } from '../../../../components/wallet-intel/RelativeTime';
import { WhalesPanel } from '../../../../components/wallet-intel/WhalesPanel';
import {
  LiquidityImpactCard,
  type LiquidityImpactData,
} from '../../../../components/wallet-intel/LiquidityImpactCard';
import { ELECTION_REGISTRY, getFlagPath } from '../../../../lib/polymarket/country-market-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONDITION_RE = /^0x[a-f0-9]{64}$/;
const TOP_PER_OUTCOME = 30;

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

function formatCompact(n: number): string {
  return n.toLocaleString('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

function applyPlaceholders(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

interface HolderEntry {
  proxyAddress: string;
  amount: number;
  outcomeIndex?: number;
  username?: string;
}

interface OutcomeBlock {
  index: number;
  name: string | null;
  totalObservedSupply: number;
  holderCount: number;
  topHolders: Array<{
    proxyAddress: string;
    username: string | null;
    amount: number;
    sharePct: number;
  }>;
  concentrationTop5Pct: number;
  concentrationTop10Pct: number;
}

/**
 * Build per-outcome breakdowns from the flat (sorted desc) holder list returned
 * by `getMarketHolders`. We deliberately do the grouping here on the page so we
 * don't have to touch the shared query helper.
 */
function buildOutcomeBlocks(
  allHolders: HolderEntry[],
  outcomeMeta: Array<{ index: number; name: string }>,
): OutcomeBlock[] {
  const byOutcome = new Map<number, HolderEntry[]>();
  for (const h of allHolders) {
    const idx = h.outcomeIndex ?? 0;
    const arr = byOutcome.get(idx);
    if (arr) arr.push(h);
    else byOutcome.set(idx, [h]);
  }

  const nameByIndex = new Map<number, string>(outcomeMeta.map((o) => [o.index, o.name]));

  const indexSet = new Set<number>();
  for (const o of outcomeMeta) indexSet.add(o.index);
  for (const k of byOutcome.keys()) indexSet.add(k);
  const orderedIndices = Array.from(indexSet).sort((a, b) => a - b);

  return orderedIndices.map((index) => {
    const group = (byOutcome.get(index) ?? []).slice().sort((a, b) => b.amount - a.amount);
    const totalObservedSupply = group.reduce((acc, h) => acc + h.amount, 0);
    const sumOf = (n: number) =>
      group.slice(0, n).reduce((acc, h) => acc + h.amount, 0);
    const concentrationTop5Pct =
      totalObservedSupply > 0 ? Math.min(100, (sumOf(5) / totalObservedSupply) * 100) : 0;
    const concentrationTop10Pct =
      totalObservedSupply > 0 ? Math.min(100, (sumOf(10) / totalObservedSupply) * 100) : 0;

    const topHolders = group.slice(0, TOP_PER_OUTCOME).map((h) => ({
      proxyAddress: h.proxyAddress,
      username: h.username ?? null,
      amount: h.amount,
      sharePct:
        totalObservedSupply > 0 ? (h.amount / totalObservedSupply) * 100 : 0,
    }));

    return {
      index,
      name: nameByIndex.get(index) ?? null,
      totalObservedSupply,
      holderCount: group.length,
      topHolders,
      concentrationTop5Pct,
      concentrationTop10Pct,
    };
  });
}

/**
 * Server-side fetch of the orderbook + impact payload from the sibling
 * `/api/wallet-intel/market/[cid]/orderbook` route. Uses the inbound
 * `host` header so it works in dev (localhost) and in any prod tenant
 * domain without baking the URL into env. Tolerates the endpoint not
 * being deployed yet (404), the upstream Polymarket call failing
 * (5xx), or a 5-second hang — all fall back to null and the consumer
 * UI gracefully degrades.
 */
async function fetchOrderbookImpact(
  conditionId: string,
): Promise<LiquidityImpactData | null> {
  try {
    const h = await headers();
    const host = h.get('host');
    const proto = h.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https');
    if (!host) return null;
    const url = `${proto}://${host}/api/wallet-intel/market/${conditionId}/orderbook`;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: ctl.signal,
        // The route itself sets Cache-Control: public, max-age=30 and
        // does in-process caching. Honour that by participating in
        // the Next data cache for the same 30 seconds.
        next: { revalidate: 30 },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const json = (await res.json()) as LiquidityImpactData;
    if (!json || typeof json !== 'object') return null;
    return json;
  } catch {
    // Swallow — graceful degradation. The card knows how to render
    // "Orderbook unavailable" when handed a null payload, but we choose
    // not to render the card at all when this returns null so the layout
    // stays clean.
    return null;
  }
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

  const [holders, whales, outcomeMeta, marketQuestion, orderbookImpact] = await Promise.all([
    getMarketHolders(conditionId),
    getMarketWhales(conditionId),
    getMarketOutcomes(conditionId).catch(() => []),
    getMarketQuestion(conditionId).catch(() => null),
    fetchOrderbookImpact(conditionId),
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

  const outcomes = buildOutcomeBlocks(holders.allHoldersSorted, outcomeMeta);

  // Bind a candidate name from the market question so we can render
  // a "supports X / against X" subtitle under each outcome header for
  // binary political markets only. Returns null for non-political
  // markets — see extractCandidateFromQuestion for the negative cases.
  const candidate = extractCandidateFromQuestion(marketQuestion);
  const supportsTpl = t('wiMarket.outcomeSubtitleSupports');
  const againstTpl = t('wiMarket.outcomeSubtitleAgainst');

  function outcomeSubtitle(name: string | null, index: number): string | null {
    if (!candidate || !name) return null;
    // outcomeIndex 0 = YES in Polymarket binary markets; outcomeIndex 1 = NO.
    // Also gate by name in case ordering is ever inverted upstream.
    const lower = name.toLowerCase();
    if (index === 0 || lower === 'yes' || lower === 'sim' || lower === 'sí') {
      return applyPlaceholders(supportsTpl, { name: candidate });
    }
    if (index === 1 || lower === 'no' || lower === 'não') {
      return applyPlaceholders(againstTpl, { name: candidate });
    }
    return null;
  }

  const outcomeUnknownTpl = t('wiMarket.outcomeUnknown');
  const holderCountTpl = t('wiMarket.holderCount');
  const concentrationPerOutcomeTpl = t('wiMarket.concentrationPerOutcome');
  const concentrationWord = t('wiMarket.concentrationTitle');

  // Initial whales payload. The interactive panel may later replace
  // this with the same shape via the API once the user picks a
  // different timeframe.
  const initialWhalesData = {
    conditionId,
    timeframe: '30d' as const,
    whales: 'whales' in whales ? whales.whales : [],
  };

  const titleFallback = registryEntry
    ? `${registryEntry.countryName} — ${registryEntry.electionType}`
    : slug || conditionId.slice(0, 14) + '...';
  const headerTitle = marketQuestion ?? titleFallback;

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
              {headerTitle}
            </h1>
            {slug && (
              <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-500 break-all">{slug}</p>
            )}
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              {t('wiMarket.snapshotAt')}{' '}
              <RelativeTime iso={holders.latestSnapshotAt} />{' '}
              · {t('wiMarket.totalHolders')}{' '}
              <span className="font-mono font-semibold">{holders.totalHolders.toLocaleString()}</span>
            </p>
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <header>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('wiMarket.outcomesHeader')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('wiMarket.concentrationSubtitle')}</p>
        </header>

        {outcomes.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
            {t('wiMarket.noSnapshot')}
          </div>
        ) : (
          outcomes.map((o) => {
            const displayName =
              o.name ?? applyPlaceholders(outcomeUnknownTpl, { index: o.index });
            const subtitle = outcomeSubtitle(o.name, o.index);
            return (
              <article
                key={o.index}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
              >
                <header className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {displayName}
                    </h3>
                    {subtitle && (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                    )}
                  </div>
                  <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {t('wiMarket.totalSupply')}: {formatCompact(o.totalObservedSupply)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {applyPlaceholders(holderCountTpl, { count: o.holderCount })}
                  </span>
                </header>

                <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                  <ConcentrationMeter
                    label={t('wiMarket.top5')}
                    percent={o.concentrationTop5Pct}
                    outcomeName={displayName}
                    concentrationLabel={concentrationWord}
                    caption={applyPlaceholders(concentrationPerOutcomeTpl, {
                      name: displayName,
                    })}
                  />
                </div>

                {o.topHolders.length === 0 ? (
                  <p className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
                    {t('wiMarket.holdersEmpty')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold w-12">{t('wi.rank')}</th>
                          <th className="px-3 py-2.5 font-semibold">{t('wiFlagged.colAddress')}</th>
                          <th className="px-3 py-2.5 font-semibold">{t('wiFlagged.colUsername')}</th>
                          <th className="px-3 py-2.5 font-semibold text-right">{t('wiMarket.colAmount')}</th>
                          <th className="px-3 py-2.5 font-semibold w-[200px]">{t('wiMarket.sharePctHeader')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {o.topHolders.map((h, i) => {
                          const sharePct = Math.max(0, Math.min(100, h.sharePct));
                          return (
                            <tr key={h.proxyAddress + i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-3 py-2 text-slate-500 font-mono tabular-nums text-xs">{i + 1}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <WalletAddress
                                  address={h.proxyAddress}
                                  href={`/${locale}/wallet-intel/wallet/${h.proxyAddress}`}
                                />
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300 text-xs">
                                {h.username ?? <span className="text-slate-400 dark:text-slate-600">—</span>}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                                {formatCompact(h.amount)}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                    <div
                                      className="h-full bg-primary/70 transition-[width] duration-300"
                                      style={{ width: `${sharePct}%` }}
                                    />
                                  </div>
                                  <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 w-12 text-right">
                                    {sharePct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      {/* Orderbook + simulated impact. Sits between per-outcome
          concentration (above) and whales (below). Gracefully omitted
          when the upstream Polymarket call failed — see
          fetchOrderbookImpact() for the failure modes. */}
      {orderbookImpact && orderbookImpact.yesBook && (
        <LiquidityImpactCard data={orderbookImpact} />
      )}

      <WhalesPanel
        conditionId={conditionId}
        locale={locale}
        initialData={initialWhalesData}
      />
    </div>
  );
}
