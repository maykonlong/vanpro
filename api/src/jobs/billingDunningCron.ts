import cron from 'node-cron';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

/**
 * FASE 31 - THE MONEY MACHINE
 * CronJob de Dunning (Cobrança Automática)
 * Roda todos os dias às 01:00 AM.
 * 
 * 1. Avisa via Log (futuro: email/whatsapp) empresas cujo trial vence em 3 dias.
 * 2. Suspende empresas cujo trial já venceu e ainda não pagaram.
 */

cron.schedule('0 1 * * *', async () => {
  logger.info('[BILLING-CRON] Iniciando varredura de ciclo de vida dos tenants...');

  const now = new Date();

  // --- 1. Empresas em Trial que vencem em 3 dias (Aviso de Urgência) ---
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const trialExpiringSoon = await prisma.company.findMany({
    where: {
      tenantStatus: 'TRIAL',
      trialEndsAt: {
        gte: now,
        lte: threeDaysFromNow
      }
    }
  });

  for (const company of trialExpiringSoon) {
    const daysLeft = Math.ceil(
      ((company.trialEndsAt?.getTime() ?? 0) - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    logger.warn(
      `[BILLING-WARN] Trial da empresa "${company.name}" (${company.id}) vence em ${daysLeft} dia(s). Considere disparar e-mail de aviso.`
    );
    // INTEGRAÇÃO FUTURA: Disparar e-mail via AWS SES / Resend / BullMQ
  }

  // --- 2. Empresas em Trial que JÁ venceram → SUSPENDER ---
  const expiredTrials = await prisma.company.findMany({
    where: {
      tenantStatus: 'TRIAL',
      trialEndsAt: { lt: now }
    }
  });

  if (expiredTrials.length > 0) {
    const ids = expiredTrials.map(c => c.id);
    await prisma.company.updateMany({
      where: { id: { in: ids } },
      data: {
        tenantStatus: 'SUSPENDED',
        suspendedAt: now
      }
    });

    for (const company of expiredTrials) {
      logger.error(
        `[BILLING-SUSPENDED] Empresa "${company.name}" (${company.id}) foi SUSPENSA. Trial expirado. Pagamento necessário.`
      );
    }
  }

  // --- 3. Empresas com cobrança recorrente vencida (PAST_DUE > 3 dias) → SUSPENDER ---
  const pastDueCutoff = new Date();
  pastDueCutoff.setDate(pastDueCutoff.getDate() - 3);

  const pastDueExpired = await prisma.company.findMany({
    where: {
      tenantStatus: 'PAST_DUE',
      updatedAt: { lt: pastDueCutoff }
    }
  });

  if (pastDueExpired.length > 0) {
    const ids = pastDueExpired.map(c => c.id);
    await prisma.company.updateMany({
      where: { id: { in: ids } },
      data: {
        tenantStatus: 'SUSPENDED',
        suspendedAt: now
      }
    });

    for (const company of pastDueExpired) {
      logger.error(
        `[BILLING-DUNNING] Empresa "${company.name}" SUSPENSA por inadimplência (PAST_DUE > 3 dias).`
      );
    }
  }

  logger.info(`[BILLING-CRON] Varredura concluída. Suspensos: ${expiredTrials.length + pastDueExpired.length}. Avisos: ${trialExpiringSoon.length}.`);
});
