import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    // 1. Verificar Assinatura (Prevenir fraude de Webhook falso)
    // const signature = req.headers['stripe-signature'] ou req.headers['asaas-signature']
    // if (!verifySignature(req.body, signature)) throw new Error('Assinatura Inválida');

    const event = req.body;
    logger.info(`💰 Recebendo Webhook Financeiro: ${event.type || 'PAYMENT_RECEIVED'}`);

    if (event.type === 'payment_intent.succeeded' || event.event === 'PAYMENT_RECEIVED') {
      const transactionId = event.data?.object?.id || event.payment?.id;
      const externalId = transactionId as string;

      if (!externalId) {
        logger.warn('Webhook recebido sem externalId de transação.');
        return res.status(400).send('Webhook Error: Sem ID');
      }

      // 2. Dar baixa no banco de dados automaticamente
      await prisma.financialTransaction.updateMany({
        where: { externalId },
        data: {
          paid: true,
          updatedAt: new Date()
        }
      });
      
      logger.info(`✅ Baixa automática efetuada para transação externa ${externalId}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error(`❌ Erro no Webhook Financeiro: ${(error as Error).message}`);
    res.status(400).send(`Webhook Error: ${(error as Error).message}`);
  }
};
