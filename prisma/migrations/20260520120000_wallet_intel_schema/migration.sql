-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "wallet";

-- CreateTable
CREATE TABLE "wallet"."wallets" (
    "id" UUID NOT NULL,
    "proxy_address" TEXT NOT NULL,
    "proxy_type" TEXT NOT NULL DEFAULT 'unknown',
    "eoa_owner_address" TEXT,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_value_usd" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."wallet_profiles" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "pseudonym" TEXT,
    "username" TEXT,
    "x_username" TEXT,
    "profile_image_url" TEXT,
    "verified_badge" BOOLEAN NOT NULL DEFAULT false,
    "last_fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."wallet_positions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "market_condition_id" TEXT NOT NULL,
    "market_slug" TEXT NOT NULL,
    "outcome_index" INTEGER NOT NULL,
    "outcome_name" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "avg_price" DOUBLE PRECISION NOT NULL,
    "current_value_usd" DOUBLE PRECISION NOT NULL,
    "pnl_usd" DOUBLE PRECISION NOT NULL,
    "pnl_percent" DOUBLE PRECISION,
    "snapshot_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."wallet_trades" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "market_condition_id" TEXT NOT NULL,
    "market_slug" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "asset_token_id" TEXT NOT NULL,
    "outcome_index" INTEGER,
    "size" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "value_usd" DOUBLE PRECISION NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "trade_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "dedup_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."market_holder_snapshots" (
    "id" UUID NOT NULL,
    "market_condition_id" TEXT NOT NULL,
    "market_slug" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
    "holders_json" JSONB NOT NULL,
    "total_holders" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_holder_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."flag_rules" (
    "id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "flag_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."red_flags" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "market_condition_id" TEXT,
    "evidence_json" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "red_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."wallet_scores" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "flag_count" INTEGER NOT NULL DEFAULT 0,
    "high_severity_count" INTEGER NOT NULL DEFAULT 0,
    "last_computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "breakdown_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_proxy_address_key" ON "wallet"."wallets"("proxy_address");

-- CreateIndex
CREATE INDEX "wallets_proxy_address_idx" ON "wallet"."wallets"("proxy_address");

-- CreateIndex
CREATE INDEX "wallets_eoa_owner_address_idx" ON "wallet"."wallets"("eoa_owner_address");

-- CreateIndex
CREATE INDEX "wallets_first_seen_at_idx" ON "wallet"."wallets"("first_seen_at");

-- CreateIndex
CREATE INDEX "wallets_active_idx" ON "wallet"."wallets"("active");

-- CreateIndex
CREATE INDEX "wallets_created_at_idx" ON "wallet"."wallets"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_profiles_wallet_id_key" ON "wallet"."wallet_profiles"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_positions_wallet_id_idx" ON "wallet"."wallet_positions"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_positions_market_condition_id_idx" ON "wallet"."wallet_positions"("market_condition_id");

-- CreateIndex
CREATE INDEX "wallet_positions_market_slug_idx" ON "wallet"."wallet_positions"("market_slug");

-- CreateIndex
CREATE INDEX "wallet_positions_snapshot_date_idx" ON "wallet"."wallet_positions"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_positions_wallet_id_market_condition_id_outcome_inde_key" ON "wallet"."wallet_positions"("wallet_id", "market_condition_id", "outcome_index", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_trades_dedup_hash_key" ON "wallet"."wallet_trades"("dedup_hash");

-- CreateIndex
CREATE INDEX "wallet_trades_wallet_id_idx" ON "wallet"."wallet_trades"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_trades_market_condition_id_idx" ON "wallet"."wallet_trades"("market_condition_id");

-- CreateIndex
CREATE INDEX "wallet_trades_market_slug_idx" ON "wallet"."wallet_trades"("market_slug");

-- CreateIndex
CREATE INDEX "wallet_trades_transaction_hash_idx" ON "wallet"."wallet_trades"("transaction_hash");

-- CreateIndex
CREATE INDEX "wallet_trades_trade_timestamp_idx" ON "wallet"."wallet_trades"("trade_timestamp");

-- CreateIndex
CREATE INDEX "wallet_trades_market_condition_id_trade_timestamp_idx" ON "wallet"."wallet_trades"("market_condition_id", "trade_timestamp");

-- CreateIndex
CREATE INDEX "wallet_trades_wallet_id_trade_timestamp_idx" ON "wallet"."wallet_trades"("wallet_id", "trade_timestamp");

-- CreateIndex
CREATE INDEX "market_holder_snapshots_market_condition_id_idx" ON "wallet"."market_holder_snapshots"("market_condition_id");

-- CreateIndex
CREATE INDEX "market_holder_snapshots_snapshot_at_idx" ON "wallet"."market_holder_snapshots"("snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_holder_snapshots_market_condition_id_snapshot_at_key" ON "wallet"."market_holder_snapshots"("market_condition_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "flag_rules_rule_key_key" ON "wallet"."flag_rules"("rule_key");

-- CreateIndex
CREATE INDEX "flag_rules_severity_idx" ON "wallet"."flag_rules"("severity");

-- CreateIndex
CREATE INDEX "flag_rules_enabled_idx" ON "wallet"."flag_rules"("enabled");

-- CreateIndex
CREATE INDEX "red_flags_wallet_id_idx" ON "wallet"."red_flags"("wallet_id");

-- CreateIndex
CREATE INDEX "red_flags_rule_key_idx" ON "wallet"."red_flags"("rule_key");

-- CreateIndex
CREATE INDEX "red_flags_market_condition_id_idx" ON "wallet"."red_flags"("market_condition_id");

-- CreateIndex
CREATE INDEX "red_flags_triggered_at_idx" ON "wallet"."red_flags"("triggered_at");

-- CreateIndex
CREATE INDEX "red_flags_wallet_id_triggered_at_idx" ON "wallet"."red_flags"("wallet_id", "triggered_at");

-- CreateIndex
CREATE INDEX "red_flags_rule_key_triggered_at_idx" ON "wallet"."red_flags"("rule_key", "triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_scores_wallet_id_key" ON "wallet"."wallet_scores"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_scores_last_computed_at_idx" ON "wallet"."wallet_scores"("last_computed_at");

-- CreateIndex
CREATE INDEX "wallet_scores_total_score_idx" ON "wallet"."wallet_scores"("total_score");

-- AddForeignKey
ALTER TABLE "wallet"."wallet_profiles" ADD CONSTRAINT "wallet_profiles_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet"."wallet_positions" ADD CONSTRAINT "wallet_positions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet"."wallet_trades" ADD CONSTRAINT "wallet_trades_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet"."red_flags" ADD CONSTRAINT "red_flags_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet"."wallet_scores" ADD CONSTRAINT "wallet_scores_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"."wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
