'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '../../i18n/context';

interface NavItem {
  href: string;
  label: string;
  /** Match the whole subtree (default) or only the exact path. */
  exact?: boolean;
}

export function SubNav() {
  const { t, locale } = useTranslation();
  const pathname = usePathname() || '';
  const base = `/${locale}/wallet-intel`;

  const items: NavItem[] = [
    { href: base, label: t('wiNav.summary'), exact: true },
    { href: `${base}/flagged`, label: t('wiNav.flagged') },
    { href: `${base}/markets`, label: t('wiNav.markets') },
    { href: `${base}/leaderboard`, label: t('wiNav.leaderboard') },
    { href: `${base}/detection`, label: t('wiNav.detection') },
  ];

  // For the markets subtree, the dynamic /market/[conditionId] page should
  // still highlight the Markets tab.
  const marketsRoot = `${base}/market`;
  const walletRoot = `${base}/wallet`;

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href || pathname === `${item.href}/`;
    if (pathname.startsWith(item.href)) return true;
    if (item.href === `${base}/markets` && pathname.startsWith(marketsRoot)) return true;
    if (item.href === `${base}/flagged` && pathname.startsWith(walletRoot)) return true;
    return false;
  }

  return (
    <nav
      className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30"
      aria-label="wallet-intel"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 overflow-x-auto">
        <ul className="flex items-center gap-1 sm:gap-2 min-w-max" role="tablist">
          {items.map((it) => {
            const active = isActive(it);
            return (
              <li key={it.href} role="presentation">
                <Link
                  href={it.href}
                  role="tab"
                  aria-selected={active}
                  className={`inline-flex items-center px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
                    active
                      ? 'text-primary border-primary'
                      : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-primary hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
