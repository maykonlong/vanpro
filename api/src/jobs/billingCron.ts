import cron from 'node-cron';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import { emailQueue } from './emailQueue';

// Roda todo dia 1, as 00:05 da manhã ("5 0 1 * *")
// Para testes locais, pode mudar para "* * * * *" (a cada minuto)
cron.schedule('5 0 1 * *', async () => {
  logger.info('🕒 Iniciando Cron de Faturamento Mensal (Billing)...');

  try {
    const students = await prisma.student.findMany({
      where: { active: true },
      include: {
        guardian: true // Para pegar email do Pai
      }
    });

    for (const student of students) {
      if (!student.monthlyFee || !student.guardian?.email) continue;

      // 1. Gera a transação pendente no Banco
      const transaction = await prisma.financialTransaction.create({
        data: {
          studentId: student.id,
          amount: student.monthlyFee,
          dueDate: new Date(new Date().getFullYear(), new Date().getMonth(), 10), // Vence dia 10
          paid: false,
          externalId: `FUTURO_ASAAS_ID_${student.id}_${Date.now()}` // Mock
        }
      });

      // 2. Envia job para a fila do Redis para disparar o email de cobrança assincronamente
      await emailQueue.add('send-invoice', {
        to: student.guardian.email,
        subject: `Cobrança Mensalidade Escolar: ${student.name}`,
        transactionId: transaction.id,
        amount: student.monthlyFee
      });
      
      logger.info(`💸 Cobrança gerada para ${student.name} e enfileirada para email.`);
    }

    logger.info('✅ Cron de Faturamento finalizado com sucesso.');
  } catch (error) {
    logger.error(`❌ Erro no Cron de Faturamento: ${(error as Error).message}`);
  }
});
