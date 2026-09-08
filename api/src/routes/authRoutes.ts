import { Router } from 'express';
import { login, verifySession, logout, generateRegistrationOptionsHandler, verifyRegistrationResponseHandler, generateAuthenticationOptionsHandler, verifyAuthenticationResponseHandler } from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/login', login);
router.get('/me', verifySession);
router.post('/logout', logout);

// Rotas de Biometria (WebAuthn / Passkeys)
// 1. Cadastrar Digital (Requer estar logado via senha antes)
router.get('/webauthn/register/options', authMiddleware, generateRegistrationOptionsHandler);
router.post('/webauthn/register/verify', authMiddleware, verifyRegistrationResponseHandler);

// 2. Fazer Login com Digital (Público, pois ainda não tem token)
router.post('/webauthn/login/options', generateAuthenticationOptionsHandler);
router.post('/webauthn/login/verify', verifyAuthenticationResponseHandler);

export default router;
