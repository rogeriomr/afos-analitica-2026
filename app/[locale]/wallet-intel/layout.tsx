import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminHeader } from '../../components/wallet-intel/AdminHeader';
import { SubNav } from '../../components/wallet-intel/SubNav';

/**
 * Wallet Intelligence admin subtree.
 *
 * - NEVER indexed (defense in depth on top of middleware Basic auth + robots.ts).
 * - No public Header/Footer — this subtree has its own slim admin shell.
 * - Distinct dark slate palette so it is visually unmistakable from the public site.
 *
 * Middleware (./middleware.ts) is the source of truth for access control:
 * any request to /<locale>/wallet-intel/* or /api/wallet-intel/* must satisfy
 * Basic auth with WALLET_INTEL_PASSWORD before this layout renders.
 */
export const metadata: Metadata = {
  title: 'AFOS Wallet Intelligence',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function WalletIntelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased">
      <AdminHeader />
      <SubNav />
      <main id="wallet-intel-main" className="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-8" role="main">
        {children}
      </main>
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12 py-6 text-center text-[11px] text-slate-500 dark:text-slate-500">
        AFOS Analytics — internal admin · noindex
      </footer>
    </div>
  );
}
