-- ACEITE-DESTRUTIVO: reescrita v3, 2026-09-10. As 7 colunas removidas sao os
-- campos monetarios em ponto flutuante (`amount`, `price`, `monthlyFee`,
-- `dailyRate`), substituidos pelos equivalentes em centavos inteiros. Manter as
-- duas representacoes lado a lado seria pior que remover: duas fontes de verdade
-- para o mesmo valor, com a soma divergindo entre elas.
--
-- Por que o rollback para a versao anterior nao e necessario: esta migration
-- pertence a reescrita inicial, aplicada sobre banco vazio. Nao existe deploy
-- anterior a ela para o qual voltar, e nenhum dado de cliente atravessou a
-- mudanca. A partir daqui vale expand/contract — remover coluna passa a exigir
-- duas releases de distancia.

/*
  Warnings:

  - You are about to drop the column `price` on the `Charter` table. All the data in the column will be lost.
  - You are about to drop the column `dailyRate` on the `Driver` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `FinancialTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `amount` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `monthlyFee` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `SubscriptionPlan` table. All the data in the column will be lost.
  - Added the required column `priceCents` to the `Charter` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountCents` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountCents` to the `FinancialTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountCents` to the `Invoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `priceCents` to the `SubscriptionPlan` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Charter" DROP COLUMN "price",
ADD COLUMN     "priceCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Driver" DROP COLUMN "dailyRate",
ADD COLUMN     "dailyRateCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "amount",
ADD COLUMN     "amountCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "FinancialTransaction" DROP COLUMN "amount",
ADD COLUMN     "amountCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "amount",
ADD COLUMN     "amountCents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "monthlyFee",
ADD COLUMN     "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubscriptionPlan" DROP COLUMN "price",
ADD COLUMN     "priceCents" INTEGER NOT NULL;
