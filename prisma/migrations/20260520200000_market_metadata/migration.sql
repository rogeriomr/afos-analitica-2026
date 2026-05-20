-- CreateTable
CREATE TABLE "wallet"."market_metadata" (
    "condition_id" TEXT NOT NULL,
    "market_slug" TEXT NOT NULL,
    "question" TEXT,
    "outcomes_json" JSONB NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "market_metadata_pkey" PRIMARY KEY ("condition_id")
);

-- CreateIndex
CREATE INDEX "market_metadata_market_slug_idx" ON "wallet"."market_metadata"("market_slug");

-- CreateIndex
CREATE INDEX "market_metadata_last_fetched_at_idx" ON "wallet"."market_metadata"("last_fetched_at");
