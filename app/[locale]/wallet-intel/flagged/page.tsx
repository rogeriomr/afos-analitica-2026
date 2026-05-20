import { getMessages } from '../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../lib/i18n/config';
import { FlaggedTable } from '../../../components/wallet-intel/FlaggedTable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function tFor(messages: Awaited<ReturnType<typeof getMessages>>) {
  return function t(key: string): string {
    const [section, field] = key.split('.', 2);
    const v = messages[section]?.[field];
    return typeof v === 'string' ? v : key;
  };
}

export default async function FlaggedPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">{t('wiFlagged.title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('wiFlagged.subtitle')}</p>
      </header>
      <FlaggedTable />
    </div>
  );
}
