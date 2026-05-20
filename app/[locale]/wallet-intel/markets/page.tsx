import Link from 'next/link';
import { getMessages } from '../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../lib/i18n/config';
import {
  ELECTION_REGISTRY,
  getFlagPath,
  type ElectionRegistryEntry,
} from '../../../lib/polymarket/country-market-map';
import { resolveConditionId } from '../../../lib/wallet-intel/conditionid-resolver';

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

interface ResolvedEntry {
  entry: ElectionRegistryEntry;
  conditionId: string | null;
}

// resolveConditionId caches in Redis with 7d TTL — N GETs per render are
// fast cache hits after the first resolve. If this becomes a hot path,
// add an in-process Map cache here.
async function resolveAll(entries: ElectionRegistryEntry[]): Promise<ResolvedEntry[]> {
  const settled = await Promise.allSettled(
    entries.map(async (e) => ({ entry: e, conditionId: await resolveConditionId(e.slug) })),
  );
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { entry: entries[i], conditionId: null };
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

export default async function MarketsPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  const enabled = ELECTION_REGISTRY.filter((e) => e.enabled);
  const resolved = await resolveAll(enabled);

  const okCount = resolved.filter((r) => r.conditionId != null).length;
  const failedCount = resolved.length - okCount;

  // Group by country for readability.
  const byCountry = new Map<string, ResolvedEntry[]>();
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
            const items = byCountry.get(iso3)!;
            const first = items[0].entry;
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
                    {items.length}
                  </span>
                </header>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {items.map(({ entry, conditionId }) => {
                    const disabled = conditionId == null;
                    const content = (
                      <div
                        className={`h-full p-3 rounded-lg border transition-colors ${
                          disabled
                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 opacity-60 cursor-not-allowed'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-primary hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                            {entry.electionType}
                          </p>
                          {entry.isPrimary && (
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {t('wiMarkets.primaryBadge')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                          {t('wiMarkets.electionDate')} {formatDate(entry.electionDate, locale)}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500 break-all leading-tight">
                          {entry.slug}
                        </p>
                        {disabled && (
                          <p className="mt-2 text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400">
                            {t('wiMarkets.unavailable')}
                          </p>
                        )}
                      </div>
                    );
                    return (
                      <li key={entry.slug}>
                        {disabled ? (
                          content
                        ) : (
                          <Link
                            href={`/${locale}/wallet-intel/market/${conditionId}`}
                            className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                          >
                            {content}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
