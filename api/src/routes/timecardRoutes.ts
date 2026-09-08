import { Router } from 'express';
import { getTimecards, punchTimecard } from '../controllers/timecardController';

const router = Router();

router.get('/', getTimecards);
router.post('/punch', punchTimecard);

export default router;
