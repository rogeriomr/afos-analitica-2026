// Preload helper — imported FIRST so dotenv loads .env.local before any
// downstream import (e.g. lib/db.ts) reads process.env at module init time.
// Without this, the prisma singleton initializes as null and downstream
// helpers like seedFlagRules() fail with "banco indisponível".
import { config } from 'dotenv'
config({ path: '.env.local' })
