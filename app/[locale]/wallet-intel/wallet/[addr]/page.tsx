import Link from 'next/link';
import { getMessages } from '../../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../../lib/i18n/config';
import { getWalletDetail } from '../../../../lib/wallet-intel/queries';
import { WalletAddress } from '../../../../components/wallet-intel/WalletAddress';
import { ScoreGauge } from '../../../../components/wallet-intel/ScoreGauge';
import { RelativeTime } from '../../../../components/wallet-intel/RelativeTime';
import { WalletDetailTabs } from '../../../../components/wallet-intel/WalletDetailTabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; addr: string }>;
}

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

function tFor(messages: Awaited<ReturnType<typeof getMessages>>) {
  return function t(key: string, fallback?: string): string {
    const [section, field] = key.split('.', 2);
    const v = messages[section]?.[field];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(', ');
    return fallback ?? key;
  };
}

function formatUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { locale: rawLocale, addr: rawAddr } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  const proxyAddress = (rawAddr || '').toLowerCase();
  if (!ADDRESS_RE.test(proxyAddress)) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-center">
        <h1 className="text-lg font-bold text-red-700 dark:text-red-300">{t('wiWallet.notFound')}</h1>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{t('wiWallet.notFoundDesc')}</p>
        <Link href={`/${locale}/wallet-intel/flagged`} className="mt-4 inline-block text-sm text-primary hover:underline">
          ← {t('wi.back')}
        </Link>
      </div>
    );
  }

  const detail = await getWalletDetail(proxyAddress);
  if ('error' in detail) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-sm text-red-700 dark:text-red-300">
        {t('wi.error')}: {detail.error}
      </div>
    );
  }
  if ('notFound' in detail) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-6 text-center">
        <h1 className="text-lg font-bold text-amber-800 dark:text-amber-300">{t('wiWallet.notFound')}</h1>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{t('wiWallet.notFoundDesc')}</p>
        <p className="mt-3 font-mono text-xs text-slate-500">{proxyAddress}</p>
        <Link href={`/${locale}/wallet-intel/flagged`} className="mt-4 inline-block text-sm text-primary hover:underline">
          ← {t('wi.back')}
        </Link>
      </div>
    );
  }

  const { wallet, profile, positions, trades, flags, score } = detail;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`/${locale}/wallet-intel/flagged`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-primary"
        >
          ← {t('wi.back')}
        </Link>
      </div>

      <header className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              {profile?.profileImageUrl && (
                <img
                  src={profile.profileImageUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="rounded-full ring-2 ring-slate-200 dark:ring-slate-700 flex-shrink-0"
                  style={{ width: 56, height: 56, objectFit: 'cover' }}
                />
              )}
              <div className="min-w-0">
                {profile?.username && (
                  <a
                    href={`https://polymarket.com/profile/${profile.username}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xl font-bold text-slate-900 dark:text-slate-50 hover:text-primary"
                  >
                    {profile.username}
                  </a>
                )}
                <div className="mt-1">
                  <WalletAddress address={wallet.proxyAddress} full className="text-sm" />
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap text-xs">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                    wallet.active
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {wallet.active ? t('wiWallet.active') : t('wiWallet.inactive')}
                  </span>
                  <a
                    href={`https://polygonscan.com/address/${wallet.proxyAddress}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {t('wi.polygonscan')} ↗
                  </a>
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs pt-2">
              <div>
                <dt className="uppercase tracking-wider text-slate-500">{t('wiWallet.headerFirstSeen')}</dt>
                <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
                  <RelativeTime iso={wallet.firstSeenAt} />
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wider text-slate-500">{t('wiWallet.headerLastSeen')}</dt>
                <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
                  <RelativeTime iso={wallet.lastSeenAt} />
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wider text-slate-500">{t('wiWallet.headerTotalValue')}</dt>
                <dd className="mt-0.5 text-sm font-mono tabular-nums text-slate-800 dark:text-slate-200">
                  {formatUsd(wallet.totalValueUsd)}
                </dd>
              </div>
              {wallet.eoaOwnerAddress && (
                <div className="sm:col-span-3">
                  <dt className="uppercase tracking-wider text-slate-500">{t('wiWallet.headerEoa')}</dt>
                  <dd className="mt-0.5">
                    <WalletAddress address={wallet.eoaOwnerAddress} />
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <ScoreGauge
              score={score?.totalScore ?? null}
              label={t('wiWallet.scoreLabel')}
              hint={score
                ? `${t('wiWallet.scoreFlags').replace('{n}', String(score.flagCount))} · ${t('wiWallet.scoreSubtitle')}`
                : t('wiWallet.scoreNone')}
            />
          </div>
        </div>
      </header>

      <WalletDetailTabs flags={flags} positions={positions} trades={trades} profile={profile} />
    </div>
  );
}
