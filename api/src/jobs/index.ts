import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma';
import { runUnscoped } from '../lib/request-context';
import { logger } from '../lib/logger';
import { audit } from '../lib/audit';

/**
 * Rotinas agendadas.
 *
 * Todas rodam em `runUnscoped` porque cruzam empresas por natureza — e por isso
 * mesmo cada uma filtra explicitamente o que precisa. Cron que roda sem escopo
 * e sem filtro e o caminho mais curto para uma cobranca ir para o cliente errado.
 *
 * Idempotencia e requisito, nao detalhe: o processo pode reiniciar no meio, e a
 * mesma janela pode ser processada duas vezes.
 */

const tasks: ScheduledTask[] = [];

const TZ = 'America/Sao_Paulo';

/** Trial vencido vira SUSPENDED. Roda de hora em hora para nao depender de meia-noite exata. */
async function suspendExpiredTrials(): Promise<void> {
  const now = new Date();
  const result = await runUnscoped('cron-trial', () =>
    prisma.company.updateMany({
      where: { tenantStatus: 'TRIAL', trialEndsAt: { lt: now } },
      data: { tenantStatus: 'SUSPENDED', suspendedAt: now },
    }),
  );
  if (result.count > 0) {
    logger.info({ count: result.count }, 'empresas suspensas por fim de período de teste');
  }
}

/** Fatura vencida e nao paga vira OVERDUE. */
async function markOverdueInvoices(): Promise<void> {
  const now = new Date();
  const result = await runUnscoped('cron-overdue', () =>
    prisma.invoice.updateMany({
      where: { status: 'PENDING', dueDate: { lt: now } },
      data: { status: 'OVERDUE' },
    }),
  );
  if (result.count > 0) logger.info({ count: result.count }, 'faturas marcadas como vencidas');
}

/**
 * Purga de dados LGPD.
 *
 * Remove em definitivo sessoes expiradas e tokens de recuperacao usados/vencidos.
 * NAO apaga aluno automaticamente: exclusao de titular passa por aprovacao
 * humana no fluxo de privacidade, porque obrigacao fiscal pode impedir.
 */
async function purgeExpiredCredentials(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [sessions, resets] = await runUnscoped('cron-lgpd-purge', async () => {
    const s = await prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    const r = await prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
    });
    return [s.count, r.count] as const;
  });

  if (sessions + resets > 0) {
    logger.info({ sessions, resets }, 'purga LGPD de credenciais expiradas');
    await audit({
      action: 'LGPD_FORGET_EXECUTED',
      description: `Purga automática: ${sessions} sessões e ${resets} tokens de recuperação expirados removidos.`,
      companyId: null,
    });
  }
}

/** Executa protegendo o agendador: excecao dentro do job nao pode matar o processo. */
function guarded(name: string, fn: () => Promise<void>) {
  return () => {
    void fn().catch((err) => logger.error({ err, job: name }, 'job falhou'));
  };
}

export function startJobs(): void {
  tasks.push(cron.schedule('7 * * * *', guarded('trials', suspendExpiredTrials), { timezone: TZ }));
  tasks.push(cron.schedule('17 3 * * *', guarded('overdue', markOverdueInvoices), { timezone: TZ }));
  tasks.push(cron.schedule('37 4 * * *', guarded('lgpd-purge', purgeExpiredCredentials), { timezone: TZ }));
  logger.info({ jobs: tasks.length }, 'rotinas agendadas ativas');
}

export function stopJobs(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}

/** Exportado para os testes exercitarem a regra sem esperar o relogio. */
export const __jobs = { suspendExpiredTrials, markOverdueInvoices, purgeExpiredCredentials };
