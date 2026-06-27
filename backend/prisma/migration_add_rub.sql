-- Migration: KassaBot — rubl qo'llab-quvvatlash
-- Railway PostgreSQL bazasida ishlatish kerak (bir marta!)

-- 1. Settings jadvaliga rubRate ustuni (eski qo'llanma kurs zahirasi sifatida)
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "rubRate" DOUBLE PRECISION NOT NULL DEFAULT 155;

-- 2. Payment jadvaliga rubAmount ustuni (Float, 2 decimal)
--    Agar oldin INT sifatida qo'shilgan bo'lsa: avval o'chirib, qaytadan qo'shing:
--    ALTER TABLE "Payment" DROP COLUMN IF EXISTS "rubAmount";
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "rubAmount" DOUBLE PRECISION;
