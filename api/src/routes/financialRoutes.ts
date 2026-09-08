import { Router } from 'express';
import { getFinancialOverview, generatePix } from '../controllers/financialController';

const router = Router();

router.get('/dre', getFinancialOverview);
router.post('/pix/generate', generatePix);

export default router;
