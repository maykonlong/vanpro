import { Router } from 'express';
import { login, verifySession, logout } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.get('/me', verifySession);
router.post('/logout', logout);

export default router;
