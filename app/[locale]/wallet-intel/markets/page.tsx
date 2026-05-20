import Link from 'next/link';
import { getMessages } from '../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../lib/i18n/config';
import {
  ELECTION_REGISTRY,
  getFlagPath,
  type ElectionRegistryEntry,
} from '../../../lib/polymarket/country-market-map';
import {
  resolveActiveConditionIds,
  type ResolvedSubMarket,
} from '../../../lib/wallet-intel/conditionid-resolver';
import { extractCandidateFromQuestion } from '../../../lib/wallet-intel/market-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

interface ResolvedEvent {
  entry: ElectionRegistryEntry;
  subMarkets: ResolvedSubMarket[];
}

async function resolveAll(entries: ElectionRegistryEntry[]): Promise<ResolvedEvent[]> {
  const settled = await Promise.allSettled(
    entries.map(async (e) => ({ entry: e, subMarkets: await resolveActiveConditionIds(e.slug) })),
  );
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { entry: entries[i], subMarkets: [] };
  });
}

function formatDate(iso: string, locale: Locale): string {
  try {
    const lang = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-US' : 'pt-BR';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

/**
 * Try to read the candidate name from the sub-market's question (e.g. "Will
 * Lula win..." → "Lula"). Falls back to a truncated question when extraction
 * fails — preserves a useful label even for non-political binaries.
 */
function candidateLabel(question: string): string {
  const c = extractCandidateFromQuestion(question);
  if (c) return c;
  // Strip leading "Will " for compact display when the question doesn't fit
  // the candidate-extraction pattern.
  return question.replace(/^Will\s+/i, '').slice(0, 60);
}

export default async function MarketsPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  const enabled = ELECTION_REGISTRY.filter((e) => e.enabled);
  const resolved = await resolveAll(enabled);

  const failedCount = resolved.filter((r) => r.subMarkets.length === 0).length;
  const totalSubMarkets = resolved.reduce((s, r) => s + r.subMarkets.length, 0);

  // Group by country for readability.
  const byCountry = new Map<string, ResolvedEvent[]>();
  for (const r of resolved) {
    const arr = byCountry.get(r.entry.iso3) ?? [];
    arr.push(r);
    byCountry.set(r.entry.iso3, arr);
  }
  const countryOrder = Array.from(byCountry.keys()).sort((a, b) => {
    const aCount = byCountry.get(a)!.length;
    const bCount = byCountry.get(b)!.length;
    if (bCount !== aCount) return bCount - aCount;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">{t('wiMarkets.title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('wiMarkets.subtitle')}</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
          {t('wiMarkets.totalSubMarkets')} <span className="font-mono font-semibold">{totalSubMarkets}</span>
        </p>
      </header>

      {failedCount > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
          {t('wiMarkets.resolveError')}{' '}
          <span className="font-mono">({failedCount}/{resolved.length})</span>
        </div>
      )}

      {enabled.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('wiMarkets.noMarkets')}</p>
      ) : (
        <div className="space-y-5">
          {countryOrder.map((iso3) => {
            const events = byCountry.get(iso3)!;
            const first = events[0].entry;
            return (
              <section
                key={iso3}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5"
              >
                <header className="flex items-center gap-2.5 mb-3">
                  <img
                    src={getFlagPath(iso3)}
                    alt=""
                    width={24}
                    height={16}
                    className="rounded-sm object-cover"
                    style={{ width: 24, height: 16 }}
                  />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {first.countryName}
                  </h2>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-500">
                    {events.length} {t('wiMarkets.eventsLabel')}
                  </span>
                </header>

                <div className="space-y-4">
                  {events.map(({ entry, subMarkets }) => {
                    const disabled = subMarkets.length === 0;
                    return (
                      <div
                        key={entry.slug}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                                {entry.electionType}
                              </p>
                              {entry.isPrimary && (
                                <span className="text-[9px] uppercase tracking-wider font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                  {t('wiMarkets.primaryBadge')}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-500 dark:text-slate-500">
                                {t('wiMarkets.electionDate')} {formatDate(entry.electionDate, locale)}
                              </span>
                            </div>
                            <p className="font-mono text-[10px] text-slate-400 dark:text-slate-600 break-all mt-0.5">
                              {entry.slug}
                            </p>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-mono">
                            {subMarkets.length} {t('wiMarkets.subMarketsLabel')}
                          </span>
                        </div>

                        {disabled ? (
                          <p className="text-[11px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400 mt-1">
                            {t('wiMarkets.unavailable')}
                          </p>
                        ) : (
                          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {subMarkets.map((sub) => {
                              const yesPct = (sub.yesProbability ?? 0) * 100;
                              // Color the probability chip by tier:
                              //   ≥30%  → emerald (genuine favorite)
                              //   ≥10%  → blue   (long-shot but plausible)
                              //   <10%  → slate  (basically nobody believes)
                              const probTier =
                                yesPct >= 30
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : yesPct >= 10
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
                              return (
                                <li key={sub.conditionId}>
                                  <Link
                                    href={`/${locale}/wallet-intel/market/${sub.conditionId}`}
                                    className="block p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-primary hover:shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    title={sub.question}
                                  >
                                    <div className="flex items-start justify-between gap-1.5">
                                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate flex-1 min-w-0">
                                        {candidateLabel(sub.question)}
                                      </p>
                                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-semibold ${probTier}`}>
                                        {yesPct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                                      {t('wiMarkets.volumeLabel')} {formatVolume(sub.volume)}
                                    </p>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
