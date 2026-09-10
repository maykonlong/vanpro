import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { afterAll, beforeEach } from 'vitest';

// Carrega .env.test ANTES de qualquer import que leia `env` — o config valida
// no momento do import e derrubaria o processo com a mensagem errada.
dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'local';
process.env.ENABLE_CRON = 'false';

if (!process.env.DATABASE_URL?.includes('vanpro_test')) {
  throw new Error(
    'A suite so roda contra o banco "vanpro_test". DATABASE_URL aponta para outro banco — ' +
      'e o proximo passo dela e TRUNCATE em todas as tabelas.',
  );
}

// Import dinamico DEPOIS do dotenv, e nao no topo: `src/config/env` valida o
// ambiente no momento em que e carregado, e um import estatico subiria antes do
// .env.test estar em `process.env` — derrubando a suite com a mensagem errada.
const { prisma } = await import('../src/lib/prisma');
const { runUnscoped } = await import('../src/lib/request-context');

/**
 * Ordem IMPORTA: a limpeza e `DELETE` filho-antes-do-pai, dentro de uma
 * transacao. Era `TRUNCATE ... RESTART IDENTITY CASCADE`, que neste ambiente
 * (Postgres em container no Windows) custava de 5 a 11 SEGUNDOS por caso —
 * cada TRUNCATE reescreve o arquivo da tabela e sincroniza em disco. Com a
 * suite completa isso seriam ~20 minutos de espera para limpar tabelas que
 * quase sempre tem menos de cem linhas. O mesmo trabalho por DELETE leva
 * ~150ms. `RESTART IDENTITY` nao faz falta: toda chave primaria aqui e uuid.
 */
const TABLES = [
  'Punch',
  'Timecard',
  'Note',
  'TeamMessage',
  'IncidentAlert',
  'AIPost',
  'AICampaign',
  'Charter',
  'Expense',
  'Invoice',
  'FinancialTransaction',
  'Student',
  'Driver',
  'Vehicle',
  'AuditLog',
  'Session',
  'PasswordResetToken',
  'Authenticator',
  'UserCompany',
  'User',
  'SaaSSubscription',
  'Company',
  'SubscriptionPlan',
  'WebhookEvent',
];

/**
 * Migrar so quando algum teste de integracao for de fato rodar.
 *
 * Antes disto o `beforeAll` migrava sempre, e por isso `vitest run tests/unit`
 * exigia Postgres de pe para exercitar teste que nao toca no banco: com o
 * container parado a suite falhava em `P1001` sem executar um caso sequer.
 * Teste de unidade que so roda com a infraestrutura completa e teste que
 * ninguem roda antes de commitar.
 *
 * Fica no `beforeEach` (e nao no `beforeAll`) porque e ali que se sabe QUAL
 * arquivo esta rodando. A flag garante uma migracao por processo — e
 * `fileParallelism: false` garante que nao ha duas correndo juntas.
 */
let migrado = false;

function migrarUmaVez(): void {
  if (migrado) return;
  migrado = true;
  // Migrations versionadas, nao `db push`: o teste tem de exercitar o mesmo
  // caminho que producao vai percorrer.
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
    env: process.env,
  });
}

beforeEach(async (ctx) => {
  // Truncar so no que fala com o banco. Teste de unidade pagando uma limpeza de
  // 24 tabelas por caso transformou a suite em 158 segundos de espera.
  if (!ctx.task.file.filepath.includes('integration')) return;

  migrarUmaVez();

  await runUnscoped('test-truncate', () =>
    prisma.$transaction(TABLES.map((t) => prisma.$executeRawUnsafe(`DELETE FROM "${t}";`))),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
