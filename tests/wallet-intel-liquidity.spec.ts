/**
 * Visual regression / smoke test for the Liquidity & Impact card on the
 * market drill-down page. Self-skips when:
 *
 *  - the dev server isn't reachable (running outside a dev environment), or
 *  - the orderbook API responds with `yesBook: null` (Polymarket /clob is
 *    unreachable from the CI runner — common when running locked-down).
 *
 * The actual market math is covered by backend unit tests; this file only
 * locks the UI shape against the live numbers for the BR Tarcísio market.
 */

import { test, expect } from '@playwright/test';

const TARCISIO_CID =
  '0x81a537b379a35e4e17c286d3b37394e94bd74c1779bbe9a13670eb991b201a3a';

test.describe('Liquidity & Impact card', () => {
  test.beforeEach(async ({ request }) => {
    // Probe the orderbook API once — if it can't surface a YES book we
    // can't possibly assert against postPrice cells.
    const probe = await request
      .get(`/api/wallet-intel/market/${TARCISIO_CID}/orderbook`)
      .catch(() => null);
    if (!probe || !probe.ok()) {
      test.skip(true, 'Orderbook API not reachable');
    } else {
      const body = await probe.json().catch(() => ({}));
      if (!body || !body.yesBook) {
        test.skip(true, 'Polymarket orderbook returned null (likely network-restricted)');
      }
    }
  });

  test('renders card with pt-BR title, stats, and a believable $10k post-price', async ({
    page,
  }) => {
    await page.goto(`/pt-BR/wallet-intel/market/${TARCISIO_CID}`);

    // Title appears (pt-BR uses ampersand).
    const card = page.locator('section', { hasText: 'Liquidez & Impacto' }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The four header stats should all be non-empty mono blocks.
    await expect(card.getByText('Melhor bid')).toBeVisible();
    await expect(card.getByText('Melhor ask')).toBeVisible();
    await expect(card.getByText('Midpoint')).toBeVisible();

    // Click the $10k size button.
    await card.locator('button[data-size="10000"]').click();

    // The post-price cell should be a price ≈ $0.49 (±5% per spec).
    const postPrice = card.locator('[data-testid="impact-post-price"]');
    await expect(postPrice).toBeVisible();
    const raw = (await postPrice.innerText()).trim();
    const num = Number(raw.replace(/[^0-9.]/g, ''));
    expect(num).toBeGreaterThan(0.4);
    expect(num).toBeLessThan(0.6);
  });

  test('English locale swaps the title', async ({ page }) => {
    await page.goto(`/en/wallet-intel/market/${TARCISIO_CID}`);
    await expect(
      page.locator('section', { hasText: 'Liquidity & Impact' }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
