import { Router } from 'express';
import { exportData, updateConsents, requestForgetMe } from '../controllers/privacyController';

const router = Router();

// Todas as rotas de privacidade devem estar protegidas pelo authMiddleware no index.ts
router.get('/export', exportData);
router.post('/consents', updateConsents);
router.post('/forget-me', requestForgetMe);

export default router;
