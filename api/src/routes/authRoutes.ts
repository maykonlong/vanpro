import { Router } from 'express';
import {
  login,
  verifySession,
  logout,
  generateRegistrationOptionsHandler,
  verifyRegistrationResponseHandler,
  generateAuthenticationOptionsHandler,
  verifyAuthenticationResponseHandler
} from '../controllers/authController';
import { forgotPassword, resetPassword } from '../controllers/passwordController';
import { generate2FA, verifyAndEnable2FA, verify2FALogin } from '../controllers/mfaController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/login', login);
router.get('/me', verifySession);
router.post('/logout', logout);

// --- Passkeys (WebAuthn / Biometria) ---
router.get('/webauthn/register/options', authMiddleware, generateRegistrationOptionsHandler);
router.post('/webauthn/register/verify', authMiddleware, verifyRegistrationResponseHandler);

router.post('/webauthn/login/options', generateAuthenticationOptionsHandler);
router.post('/webauthn/login/verify', verifyAuthenticationResponseHandler);

// --- Recuperação de Senha ---
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// --- 2FA (Google Authenticator) ---
router.get('/2fa/generate', authMiddleware, generate2FA);
router.post('/2fa/verify', authMiddleware, verifyAndEnable2FA);
router.post('/2fa/login', verify2FALogin);

export default router;
