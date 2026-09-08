import { Router } from 'express';
import { handlePaymentWebhook } from '../controllers/webhookController';

const router = Router();

// Rota POST exposta para o Asaas/Stripe
router.post('/payment', handlePaymentWebhook);

export default router;
