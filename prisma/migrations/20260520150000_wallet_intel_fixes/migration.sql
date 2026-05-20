-- Wallet Intelligence — P0/P1 data-layer fixes
-- 1) Track on-chain wallet age separately from AFOS-observed age.
-- 2) Make RedFlag dedup deterministic via evidence_hash + composite UNIQUE.

-- ─── Wallet.chainFirstActivityAt ────────────────────────────────────
-- Nullable column — backfilled best-effort per refresh from earliest
-- /trades or /activity timestamp (true on-chain genesis requires a
-- Polygon RPC sweep, which is V2).
ALTER TABLE "wallet"."wallets" ADD COLUMN "chain_first_activity_at" TIMESTAMPTZ;
CREATE INDEX "wallets_chain_first_activity_at_idx" ON "wallet"."wallets" ("chain_first_activity_at");

-- ─── RedFlag.evidenceHash ───────────────────────────────────────────
-- Required field. Backfilled with '' so existing rows pass the UNIQUE
-- constraint; the DEFAULT is dropped immediately so future inserts must
-- supply a real hash (computed by detector from the evidence JSON).
ALTER TABLE "wallet"."red_flags" ADD COLUMN "evidence_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "wallet"."red_flags" ALTER COLUMN "evidence_hash" DROP DEFAULT;

-- Composite UNIQUE for dedup. NULL marketConditionId is treated as
-- distinct by PostgreSQL — that's intentional, see schema.prisma comment.
CREATE UNIQUE INDEX "uq_redflag_dedup" ON "wallet"."red_flags" ("wallet_id", "rule_key", "market_condition_id", "evidence_hash");
