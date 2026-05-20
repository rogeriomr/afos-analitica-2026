/**
 * Shared synthetic-context builders for the rules unit tests.
 *
 * These helpers cast plain objects to the Prisma row types so we don't have to
 * hand-construct every default field — only the fields the rules actually
 * read are filled in. Each builder accepts `overrides` for per-test tuning.
 */
import type {
  Wallet,
  WalletPosition,
  WalletTrade,
  MarketHolderSnapshot,
} from '@prisma/client';

export function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    proxyAddress: '0x' + '1'.repeat(40),
    proxyType: 'unknown',
    eoaOwnerAddress: null,
    firstSeenAt: new Date(),
    chainFirstActivityAt: null,
    lastSeenAt: new Date(),
    totalValueUsd: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides } as Wallet;
}

export function makePosition(
  overrides: Partial<WalletPosition> = {},
): WalletPosition {
  const base = {
    id: '00000000-0000-0000-0000-000000000010',
    walletId: '00000000-0000-0000-0000-000000000001',
    marketConditionId: '0xmarket0000000000000000000000000000000000',
    marketSlug: 'market-slug',
    outcomeIndex: 0,
    outcomeName: 'Yes',
    size: 1000,
    avgPrice: 0.5,
    currentValueUsd: 500,
    pnlUsd: 0,
    pnlPercent: null,
    snapshotDate: new Date(),
    createdAt: new Date(),
  };
  return { ...base, ...overrides } as WalletPosition;
}

export function makeTrade(overrides: Partial<WalletTrade> = {}): WalletTrade {
  const base = {
    id: '00000000-0000-0000-0000-000000000020',
    walletId: '00000000-0000-0000-0000-000000000001',
    marketConditionId: '0xmarket0000000000000000000000000000000000',
    marketSlug: 'market-slug',
    side: 'BUY',
    assetTokenId: 'token-1',
    outcomeIndex: 0,
    size: 100,
    price: 0.5,
    valueUsd: 50,
    transactionHash: '0xtx',
    tradeTimestamp: new Date(),
    dedupHash: 'dedup',
    createdAt: new Date(),
  };
  return { ...base, ...overrides } as WalletTrade;
}

export function makeHolderSnapshot(
  overrides: Partial<MarketHolderSnapshot> = {},
): MarketHolderSnapshot {
  const base = {
    id: '00000000-0000-0000-0000-000000000030',
    marketConditionId: '0xmarket0000000000000000000000000000000000',
    marketSlug: 'market-slug',
    snapshotAt: new Date(),
    holdersJson: [],
    totalHolders: 0,
    createdAt: new Date(),
  };
  return { ...base, ...overrides } as MarketHolderSnapshot;
}
