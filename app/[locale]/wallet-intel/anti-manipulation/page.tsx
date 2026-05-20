import { getMessages } from '../../../../lib/i18n/get-messages';
import { isValidLocale, type Locale } from '../../../../lib/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

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

/**
 * Interpolate {placeholder} tokens in a translated string against a map.
 * Used for the few keys that embed runtime values (e.g. {asOf}).
 */
function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`));
}

/**
 * Long-form educational article about manipulation mechanics in CLOB-based
 * prediction markets and how AFOS attempts to detect them.
 *
 * Layout choices:
 * - Two-column on desktop: sticky TOC (w-56) on the left, prose on the right.
 *   On mobile, the TOC collapses to a static block above the article.
 * - Every <h2> has a stable `id` so the TOC anchor-jumps work and external
 *   links can deep-link into any section.
 * - Callouts use amber tinting consistent with the rest of the admin shell;
 *   case-study cards use a dedicated outlined card pattern with a label-grid.
 * - All copy comes from `wiAntiManip.*` keys with three-locale parity.
 */
export default async function AntiManipulationPage({ params }: PageProps) {
  const { locale: rawLocale } = await params;
  const locale = (isValidLocale(rawLocale) ? rawLocale : 'pt-BR') as Locale;
  const messages = await getMessages(locale);
  const t = tFor(messages);

  // Sections drive both the TOC and the heading IDs. Keeping them in one
  // array guarantees the two never drift apart.
  const sections: Array<{ id: string; title: string }> = [
    { id: 'intro', title: t('wiAntiManip.section1Title') },
    { id: 'orderbook', title: t('wiAntiManip.section2Title') },
    { id: 'negrisk', title: t('wiAntiManip.section3Title') },
    { id: 'window', title: t('wiAntiManip.section4Title') },
    { id: 'multileg', title: t('wiAntiManip.section5Title') },
    { id: 'fredi', title: t('wiAntiManip.section6Title') },
    { id: 'other-cases', title: t('wiAntiManip.section7Title') },
    { id: 'academic', title: t('wiAntiManip.academicTitle') },
    { id: 'br-context', title: t('wiAntiManip.brContextTitle') },
    { id: 'methodology', title: t('wiAntiManip.methodologyTitle') },
    { id: 'detection', title: t('wiAntiManip.section8Title') },
    { id: 'contribute', title: t('wiAntiManip.section9Title') },
    { id: 'glossary', title: t('wiAntiManip.section10Title') },
    { id: 'sources', title: t('wiAntiManip.sourcesTitle') },
  ];

  // Case studies inserted at the AGENT-A-RESEARCH-MERGE-POINT in section 7.
  // Each entry mirrors the dl-grid layout used by the Théo case in section 6.
  // `sourceLinks` pairs the visible label with an explicit URL — keeping URLs
  // in code (not i18n) avoids translators having to maintain link integrity.
  const otherCases: Array<{
    keyPrefix: string;
    sourceLinks: Array<{ href: string; labelKey: string }>;
  }> = [
    {
      keyPrefix: 'case2WashTrading',
      sourceLinks: [
        { href: 'https://fortune.com/crypto/2024/10/30/polymarket-trump-harris-wash-trading-chaos-labs/', labelKey: 'sourceFortuneWashTrading' },
        { href: 'https://www.incadigital.com/', labelKey: 'sourceIncaDigital' },
      ],
    },
    {
      keyPrefix: 'case3UmaOracle',
      sourceLinks: [
        { href: 'https://thedefiant.io/news/defi/polymarket-s-usd7m-ukraine-mineral-deal-debacle-traced-to-oracle-whale', labelKey: 'sourceDefiantUma' },
        { href: 'https://www.theblock.co/post/348171/polymarket-says-governance-attack-by-uma-whale-to-hijack-a-bets-resolution-is-unprecedented', labelKey: 'sourceBlockUma' },
      ],
    },
    {
      keyPrefix: 'case4VanDyke',
      sourceLinks: [
        { href: 'https://www.justice.gov/usao-sdny/pr/us-soldier-charged-using-classified-information-profit-prediction-market-bets', labelKey: 'sourceDojVanDyke' },
        { href: 'https://www.npr.org/2026/04/23/nx-s1-5797957/maduro-raid-charges-polymarket-insider', labelKey: 'sourceNprVanDyke' },
        { href: 'https://www.congress.gov/bill/119th-congress/house-bill/7004', labelKey: 'sourceHr7004' },
        { href: 'https://ritchietorres.house.gov/media/press-releases/torres-introduces-public-integrity-financial-prediction-markets-act', labelKey: 'sourceTorresPress' },
      ],
    },
    {
      keyPrefix: 'case5IranPattern',
      sourceLinks: [
        { href: 'https://www.cnn.com/2026/03/24/politics/iran-war-bets-prediction-markets', labelKey: 'sourceCnnIran' },
        { href: 'https://www.npr.org/2026/02/12/polymarket-iran-strikes-bets', labelKey: 'sourceNprIran' },
      ],
    },
    {
      keyPrefix: 'case6AugurInvalid',
      sourceLinks: [
        { href: 'https://bravenewcoin.com/insights/augur-invalid-market-scam-explained', labelKey: 'sourceBraveAugur' },
        { href: 'https://cointelegraph.com/news/augur-prediction-market-invalidity-exploit', labelKey: 'sourceCointelegraphAugur' },
        { href: 'https://github.com/AugurProject/whitepaper/blob/master/Lituus/English/Augur_Lituus_Whitepaper.pdf', labelKey: 'sourceAugurLituus' },
      ],
    },
    {
      keyPrefix: 'case7PredictIt',
      sourceLinks: [
        { href: 'https://aidensingh.substack.com/p/predictit-inefficiencies-2020', labelKey: 'sourceSinghPredictIt' },
      ],
    },
  ];

  // Academic papers. `linkHref` is hard-coded; `linkLabel` is i18n so locales
  // can shorten the citation if needed.
  const papers: Array<{ keyPrefix: string; linkHref: string }> = [
    { keyPrefix: 'paper1', linkHref: 'https://arxiv.org/abs/2503.03312' },
    { keyPrefix: 'paper2', linkHref: 'https://arxiv.org/abs/2603.03136' },
    { keyPrefix: 'paper3', linkHref: 'https://doi.org/10.1016/j.jebo.2005.03.013' },
    { keyPrefix: 'paper4', linkHref: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3431139' },
    { keyPrefix: 'paper5', linkHref: 'https://www.cs.cmu.edu/~sandholm/decision%20rules%20and%20decision%20markets.AAMAS10.pdf' },
  ];

  // Detection methodology rows. Same structure as cases: label key + body key.
  const methodologies: Array<{ nameKey: string; descKey: string }> = [
    { nameKey: 'method1Name', descKey: 'method1Desc' },
    { nameKey: 'method2Name', descKey: 'method2Desc' },
    { nameKey: 'method3Name', descKey: 'method3Desc' },
    { nameKey: 'method4Name', descKey: 'method4Desc' },
  ];

  // Sources appendix groups. Each group has a label key and a flat list of
  // { href, labelKey } items. URLs are inline (not i18n) for the same reason
  // as the case-source links above.
  const sourceGroups: Array<{
    titleKey: string;
    items: Array<{ href: string; labelKey: string }>;
  }> = [
    {
      titleKey: 'sourcesGroupCases',
      items: [
        { href: 'https://fortune.com/crypto/2024/10/30/polymarket-trump-harris-wash-trading-chaos-labs/', labelKey: 'sourceFortuneWashTrading' },
        { href: 'https://www.incadigital.com/', labelKey: 'sourceIncaDigital' },
        { href: 'https://thedefiant.io/news/defi/polymarket-s-usd7m-ukraine-mineral-deal-debacle-traced-to-oracle-whale', labelKey: 'sourceDefiantUma' },
        { href: 'https://www.theblock.co/post/348171/polymarket-says-governance-attack-by-uma-whale-to-hijack-a-bets-resolution-is-unprecedented', labelKey: 'sourceBlockUma' },
        { href: 'https://www.justice.gov/usao-sdny/pr/us-soldier-charged-using-classified-information-profit-prediction-market-bets', labelKey: 'sourceDojVanDyke' },
        { href: 'https://www.npr.org/2026/04/23/nx-s1-5797957/maduro-raid-charges-polymarket-insider', labelKey: 'sourceNprVanDyke' },
        { href: 'https://www.congress.gov/bill/119th-congress/house-bill/7004', labelKey: 'sourceHr7004' },
        { href: 'https://ritchietorres.house.gov/media/press-releases/torres-introduces-public-integrity-financial-prediction-markets-act', labelKey: 'sourceTorresPress' },
        { href: 'https://www.cnn.com/2026/03/24/politics/iran-war-bets-prediction-markets', labelKey: 'sourceCnnIran' },
        { href: 'https://www.npr.org/2026/02/12/polymarket-iran-strikes-bets', labelKey: 'sourceNprIran' },
        { href: 'https://bravenewcoin.com/insights/augur-invalid-market-scam-explained', labelKey: 'sourceBraveAugur' },
        { href: 'https://cointelegraph.com/news/augur-prediction-market-invalidity-exploit', labelKey: 'sourceCointelegraphAugur' },
        { href: 'https://github.com/AugurProject/whitepaper/blob/master/Lituus/English/Augur_Lituus_Whitepaper.pdf', labelKey: 'sourceAugurLituus' },
        { href: 'https://aidensingh.substack.com/p/predictit-inefficiencies-2020', labelKey: 'sourceSinghPredictIt' },
      ],
    },
    {
      titleKey: 'sourcesGroupAcademic',
      items: [
        { href: 'https://arxiv.org/abs/2503.03312', labelKey: 'sourceRasoolyRozzi' },
        { href: 'https://arxiv.org/abs/2603.03136', labelKey: 'sourceTsangYang' },
        { href: 'https://doi.org/10.1016/j.jebo.2005.03.013', labelKey: 'sourceHansonOprea' },
        { href: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3431139', labelKey: 'sourceCarteaSpoofing' },
        { href: 'https://www.cs.cmu.edu/~sandholm/decision%20rules%20and%20decision%20markets.AAMAS10.pdf', labelKey: 'sourceOthmanSandholm' },
      ],
    },
    {
      titleKey: 'sourcesGroupRegulation',
      items: [
        { href: 'https://www.gov.br/anatel/pt-br/assuntos/noticias/bloqueio-plataformas-mercados-previsao-2026', labelKey: 'sourceAnatel' },
        { href: 'https://www.planalto.gov.br/ccivil_03/leis/l9504.htm', labelKey: 'sourceLeiEleicoes' },
        { href: 'https://www.tse.jus.br/legislacao/compilada/res/2019/resolucao-no-23-600-de-12-de-dezembro-de-2019', labelKey: 'sourceTseRes' },
        { href: 'https://www.gov.br/cvm/pt-br/assuntos/noticias/derivativos-eleitorais-2026', labelKey: 'sourceCvm' },
      ],
    },
    {
      titleKey: 'sourcesGroupMethodology',
      items: [
        { href: 'https://thedefiant.io/news/defi/polymarket-taps-chainalysis-to-police-insider-trading', labelKey: 'sourceChainalysisPolymarket' },
        { href: 'https://bubblemaps.io/', labelKey: 'sourceBubblemaps' },
      ],
    },
  ];

  const glossary = Array.from({ length: 10 }, (_, i) => ({
    term: t(`wiAntiManip.glossaryTerm${i + 1}`),
    def: t(`wiAntiManip.glossaryDef${i + 1}`),
  }));

  const ruleRows = [
    { pattern: t('wiAntiManip.section8RowPushPattern'), rule: t('wiAntiManip.section8RowPushRule'), status: t('wiAntiManip.section8RowPushStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowConcPattern'), rule: t('wiAntiManip.section8RowConcRule'), status: t('wiAntiManip.section8RowConcStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowFragPattern'), rule: t('wiAntiManip.section8RowFragRule'), status: t('wiAntiManip.section8RowFragStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowCoordPattern'), rule: t('wiAntiManip.section8RowCoordRule'), status: t('wiAntiManip.section8RowCoordStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowOutsizedPattern'), rule: t('wiAntiManip.section8RowOutsizedRule'), status: t('wiAntiManip.section8RowOutsizedStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowNewPattern'), rule: t('wiAntiManip.section8RowNewRule'), status: t('wiAntiManip.section8RowNewStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowFundingPattern'), rule: t('wiAntiManip.section8RowFundingRule'), status: t('wiAntiManip.section8RowFundingStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowWashPattern'), rule: t('wiAntiManip.section8RowWashRule'), status: t('wiAntiManip.section8RowWashStatus'), active: true },
    { pattern: t('wiAntiManip.section8RowCrossPattern'), rule: t('wiAntiManip.section8RowCrossRule'), status: t('wiAntiManip.section8RowCrossStatus'), active: false },
  ];

  const asOf = t('wiAntiManip.asOfWriting');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
          {t('wiAntiManip.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('wiAntiManip.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-6 lg:gap-8">
        {/* TOC ---------------------------------------------------------- */}
        <aside
          className="lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto"
          aria-label={t('wiAntiManip.tocLabel')}
        >
          <nav className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-500 mb-2 px-2">
              {t('wiAntiManip.tocLabel')}
            </p>
            <ol className="text-xs space-y-0.5">
              {sections.map((s, idx) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex items-start gap-2 px-2 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                  >
                    <span className="font-mono text-slate-400 dark:text-slate-600 shrink-0 tabular-nums">
                      {idx + 1}.
                    </span>
                    <span className="leading-snug">{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        {/* Article ------------------------------------------------------ */}
        <article className="min-w-0 space-y-10 text-slate-800 dark:text-slate-200 leading-relaxed">
          <p className="text-base text-slate-700 dark:text-slate-300 border-l-2 border-primary pl-4 italic">
            {t('wiAntiManip.intro')}
          </p>

          {/* 1 Introduction */}
          <section className="space-y-3">
            <h2 id="intro" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              1. {t('wiAntiManip.section1Title')}
            </h2>
            <p>{t('wiAntiManip.section1P1')}</p>
            <p>{t('wiAntiManip.section1P2')}</p>
            <p>{t('wiAntiManip.section1P3')}</p>
          </section>

          {/* 2 Orderbook mechanics */}
          <section className="space-y-3">
            <h2 id="orderbook" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              2. {t('wiAntiManip.section2Title')}
            </h2>
            <p>{t('wiAntiManip.section2P1')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.section2H1')}
            </h3>
            <p>{t('wiAntiManip.section2P4')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.section2H2')}
            </h3>
            <p>{t('wiAntiManip.section2P5')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.section2H3')}
            </h3>
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
              <p className="text-sm text-amber-900 dark:text-amber-200 mb-2">
                {interpolate(t('wiAntiManip.section2ExampleP1'), { asOf })}
              </p>
              <ul className="text-sm text-amber-900 dark:text-amber-200 list-disc pl-5 space-y-1 font-mono">
                <li>{t('wiAntiManip.section2ExampleBullet1')}</li>
                <li>{t('wiAntiManip.section2ExampleBullet2')}</li>
                <li>{t('wiAntiManip.section2ExampleBullet3')}</li>
                <li className="font-semibold">{t('wiAntiManip.section2ExampleBullet4')}</li>
              </ul>
            </div>
            <p>{t('wiAntiManip.section2ExampleP2')}</p>
          </section>

          {/* 3 NegRisk */}
          <section className="space-y-3">
            <h2 id="negrisk" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              3. {t('wiAntiManip.section3Title')}
            </h2>
            <p>{t('wiAntiManip.section3P1')}</p>
            <pre className="rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 font-mono text-sm overflow-x-auto">
              {t('wiAntiManip.section3Code')}
            </pre>
            <p>{t('wiAntiManip.section3P2')}</p>
            <p>{t('wiAntiManip.section3P3')}</p>
          </section>

          {/* 4 Manipulation window */}
          <section className="space-y-3">
            <h2 id="window" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              4. {t('wiAntiManip.section4Title')}
            </h2>
            <p>{t('wiAntiManip.section4P1')}</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('wiAntiManip.section4Bullet1')}</li>
              <li>{t('wiAntiManip.section4Bullet2')}</li>
              <li>{t('wiAntiManip.section4Bullet3')}</li>
              <li>{t('wiAntiManip.section4Bullet4')}</li>
            </ul>
            <p>{t('wiAntiManip.section4P2')}</p>
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-900 dark:text-amber-200 font-medium">
              {t('wiAntiManip.section4Callout')}
            </div>
          </section>

          {/* 5 Multi-leg */}
          <section className="space-y-3">
            <h2 id="multileg" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              5. {t('wiAntiManip.section5Title')}
            </h2>
            <p>{t('wiAntiManip.section5P1')}</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('wiAntiManip.section5Bullet1')}</li>
              <li>{t('wiAntiManip.section5Bullet2')}</li>
              <li>{t('wiAntiManip.section5Bullet3')}</li>
            </ul>
            <p>{t('wiAntiManip.section5P2')}</p>
            <p>{t('wiAntiManip.section5P3')}</p>
          </section>

          {/* 6 Fredi9999 case */}
          <section className="space-y-3">
            <h2 id="fredi" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              6. {t('wiAntiManip.section6Title')}
            </h2>
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
              <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('wiAntiManip.section6CaseDateLabel')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">{t('wiAntiManip.section6CaseDate')}</dd>
                </div>
                <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('wiAntiManip.section6CaseCapitalLabel')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">{t('wiAntiManip.section6CaseCapital')}</dd>
                </div>
                <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('wiAntiManip.section6CaseMechanismLabel')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">{t('wiAntiManip.section6CaseMechanism')}</dd>
                </div>
                <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('wiAntiManip.section6CaseDetectionLabel')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">{t('wiAntiManip.section6CaseDetection')}</dd>
                </div>
                <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('wiAntiManip.section6CaseOutcomeLabel')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">{t('wiAntiManip.section6CaseOutcome')}</dd>
                </div>
              </dl>
            </div>
            <p>{t('wiAntiManip.section6P1')}</p>
            {/* AGENT-A-RESEARCH-MERGE-POINT — additional sourcing/detail for the
                Fredi9999 / Théo case (Chainalysis primary sources, timeline
                clarifications, link to the report) will be inserted here. */}
          </section>

          {/* 7 Other cases */}
          <section className="space-y-4">
            <h2 id="other-cases" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              7. {t('wiAntiManip.section7Title')}
            </h2>
            <p>{t('wiAntiManip.section7Intro')}</p>
            {/* AGENT-A-RESEARCH-MERGE-POINT — case-study cards from the deep
                research document, rendered with the same dl-grid layout as the
                Théo case in section 6. */}
            <div className="space-y-5">
              {otherCases.map((c) => (
                <div
                  key={c.keyPrefix}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden"
                >
                  <h3 className="px-4 py-3 text-base font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
                    {t(`wiAntiManip.${c.keyPrefix}Title`)}
                  </h3>
                  <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseDateLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`wiAntiManip.${c.keyPrefix}Date`)}</dd>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseCapitalLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`wiAntiManip.${c.keyPrefix}Capital`)}</dd>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseMechanismLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`wiAntiManip.${c.keyPrefix}Mechanism`)}</dd>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseDetectionLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`wiAntiManip.${c.keyPrefix}Detection`)}</dd>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseOutcomeLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`wiAntiManip.${c.keyPrefix}Outcome`)}</dd>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] sm:grid-cols-[10rem_1fr] gap-2 px-4 py-3">
                      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                        {t('wiAntiManip.caseSourcesLabel')}
                      </dt>
                      <dd className="text-slate-800 dark:text-slate-200 space-y-1">
                        <p className="text-slate-700 dark:text-slate-300">
                          {t(`wiAntiManip.${c.keyPrefix}Sources`)}
                        </p>
                        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {c.sourceLinks.map((link) => (
                            <li key={link.href}>
                              <a
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline hover:text-primary/80"
                              >
                                {t(`wiAntiManip.${link.labelKey}`)}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>

          {/* 8 Academic research */}
          <section className="space-y-4">
            <h2 id="academic" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              8. {t('wiAntiManip.academicTitle')}
            </h2>
            <p>{t('wiAntiManip.academicIntro')}</p>
            <ol className="space-y-4 list-none pl-0">
              {papers.map((p, idx) => (
                <li
                  key={p.keyPrefix}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-slate-400 dark:text-slate-600 tabular-nums shrink-0">
                      [{idx + 1}]
                    </span>
                    <h3 className="italic font-semibold text-slate-900 dark:text-slate-100">
                      {t(`wiAntiManip.${p.keyPrefix}Title`)}
                    </h3>
                  </div>
                  <p className="mt-1 ml-8 text-sm text-slate-600 dark:text-slate-400">
                    {t(`wiAntiManip.${p.keyPrefix}Citation`)} ·{' '}
                    <a
                      href={p.linkHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    >
                      {t(`wiAntiManip.${p.keyPrefix}LinkLabel`)}
                    </a>
                  </p>
                  <p className="mt-2 ml-8 text-sm">{t(`wiAntiManip.${p.keyPrefix}Summary`)}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* 9 Brazilian electoral context */}
          <section className="space-y-3">
            <h2 id="br-context" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              9. {t('wiAntiManip.brContextTitle')}
            </h2>
            <p>{t('wiAntiManip.brContextIntro')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.brContextAnatelTitle')}
            </h3>
            <p>{t('wiAntiManip.brContextAnatelBody')}</p>
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-900 dark:text-amber-200">
              {t('wiAntiManip.brContextAnatelNote')}
            </div>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.brContextTseTitle')}
            </h3>
            <p>{t('wiAntiManip.brContextTseBody')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.brContextTseCrossRefTitle')}
            </h3>
            <p>{t('wiAntiManip.brContextTseCrossRefBody')}</p>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.brContextRisksTitle')}
            </h3>
            <ol className="list-decimal pl-6 space-y-2 marker:font-semibold marker:text-slate-500">
              <li>{t('wiAntiManip.brContextRisk1')}</li>
              <li>{t('wiAntiManip.brContextRisk2')}</li>
              <li>{t('wiAntiManip.brContextRisk3')}</li>
            </ol>
          </section>

          {/* 10 Detection methodologies */}
          <section className="space-y-3">
            <h2 id="methodology" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              10. {t('wiAntiManip.methodologyTitle')}
            </h2>
            <p>{t('wiAntiManip.methodologyIntro')}</p>
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {methodologies.map((m) => (
                <div
                  key={m.nameKey}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
                >
                  <dt className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    {t(`wiAntiManip.${m.nameKey}`)}
                  </dt>
                  <dd className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                    {t(`wiAntiManip.${m.descKey}`)}
                  </dd>
                </div>
              ))}
            </dl>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.methodGapTitle')}
            </h3>
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-900 dark:text-amber-200">
              {t('wiAntiManip.methodGapBody')}
            </div>

            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-4">
              {t('wiAntiManip.methodAfosTitle')}
            </h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('wiAntiManip.methodAfosBullet1')}</li>
              <li>{t('wiAntiManip.methodAfosBullet2')}</li>
              <li>{t('wiAntiManip.methodAfosBullet3')}</li>
            </ul>
          </section>

          {/* 11 Detection table */}
          <section className="space-y-3">
            <h2 id="detection" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              11. {t('wiAntiManip.section8Title')}
            </h2>
            <p>{t('wiAntiManip.section8P1')}</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2.5 px-3 font-medium">{t('wiAntiManip.section8ColPattern')}</th>
                    <th className="py-2.5 px-3 font-medium">{t('wiAntiManip.section8ColRule')}</th>
                    <th className="py-2.5 px-3 font-medium">{t('wiAntiManip.section8ColStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950/40">
                  {ruleRows.map((row) => (
                    <tr key={row.rule} className="align-top">
                      <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">{row.pattern}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">
                        {row.rule}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            <span aria-hidden="true">✓</span>
                            <span>{row.status}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {row.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{t('wiAntiManip.section8P2')}</p>
          </section>

          {/* 12 Contribute */}
          <section className="space-y-3">
            <h2 id="contribute" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              12. {t('wiAntiManip.section9Title')}
            </h2>
            <p>
              {t('wiAntiManip.section9P1').split('github.com/AFOS-Analytics/afos-analitica-2026').map((chunk, i, arr) =>
                i < arr.length - 1 ? (
                  <span key={i}>
                    {chunk}
                    <a
                      href="https://github.com/AFOS-Analytics/afos-analitica-2026"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80 font-mono"
                    >
                      github.com/AFOS-Analytics/afos-analitica-2026
                    </a>
                  </span>
                ) : (
                  <span key={i}>{chunk}</span>
                ),
              )}
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('wiAntiManip.section9Bullet1')}</li>
              <li>{t('wiAntiManip.section9Bullet2')}</li>
              <li>{t('wiAntiManip.section9Bullet3')}</li>
              <li>{t('wiAntiManip.section9Bullet4')}</li>
            </ul>
            <p>{t('wiAntiManip.section9P2')}</p>
          </section>

          {/* 13 Glossary */}
          <section className="space-y-3">
            <h2 id="glossary" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              13. {t('wiAntiManip.section10Title')}
            </h2>
            <dl className="grid grid-cols-1 gap-3">
              {glossary.map((g) => (
                <div
                  key={g.term}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3"
                >
                  <dt className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{g.term}</dt>
                  <dd className="text-sm text-slate-700 dark:text-slate-300 mt-1">{g.def}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 14 Sources appendix */}
          <section className="space-y-3">
            <h2 id="sources" className="scroll-mt-20 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
              14. {t('wiAntiManip.sourcesTitle')}
            </h2>
            <p>{t('wiAntiManip.sourcesIntro')}</p>
            <div className="space-y-4">
              {sourceGroups.map((group) => (
                <div key={group.titleKey}>
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-2">
                    {t(`wiAntiManip.${group.titleKey}`)}
                  </h3>
                  <ul className="list-disc pl-6 space-y-1 text-sm">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline hover:text-primary/80 break-all"
                        >
                          {t(`wiAntiManip.${item.labelKey}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <footer className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <p className="text-xs text-slate-500 dark:text-slate-500 italic">
              {t('wiAntiManip.footerNote')}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
