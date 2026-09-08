import cron from 'node-cron';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

// ----------------------------------------------------
// LGPD Data Purge (Direito ao Esquecimento & Retenção)
// ----------------------------------------------------
// Roda todo dia às 03:00 da manhã
cron.schedule('0 3 * * *', async () => {
  logger.info('[CRON] Iniciando rotina de limpeza LGPD (Data Purge)...');

  try {
    // 1. Apagar PERMANENTEMENTE alunos que foram "Soft Deleted" há mais de 5 Anos
    // (5 anos é o prazo prescricional para guardar recibos/faturas fiscais)
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    const expiredStudents = await prisma.student.findMany({
      where: {
        deletedAt: { lte: fiveYearsAgo }
      }
    });

    for (const student of expiredStudents) {
      await prisma.student.delete({ where: { id: student.id } });
      logger.info(`[LGPD] Hard Delete do aluno ${student.id} (Retenção Fiscal de 5 anos expirada)`);
    }

    // 2. Apagar PERMANENTEMENTE alunos em que a Empresa/Gestor aprovou a Exclusão Antecipada 
    // (O Pai pediu via Privacy Portal e o Gestor conferiu que não havia dívidas)
    const deletionRequestedStudents = await prisma.student.findMany({
      where: {
        deleteRequestStatus: 'DELETED'
      }
    });

    for (const student of deletionRequestedStudents) {
      // Aqui num sistema avançado poderíamos fazer "Anonymization" em vez de exclusão
      // Mas para a LGPD, excluir os PII (Nomes/Fotos) e manter os pagamentos separados funciona.
      await prisma.student.delete({ where: { id: student.id } });
      logger.info(`[LGPD] Hard Delete Antecipado do aluno ${student.id} (Direito ao Esquecimento concedido pelo Gestor)`);
    }

    logger.info('[CRON] Rotina de limpeza LGPD concluída.');
  } catch (error) {
    logger.error(`[CRON] Erro na limpeza LGPD: ${(error as Error).message}`);
  }
});
