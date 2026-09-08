import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
    const decoded = jwt.verify(token, jwtSecret) as { id: string, role: string, tenantId: string, fingerprint?: string };

    // Validação de Segurança Máxima: Checar DNA do Navegador (User-Agent)
    const currentUserAgent = req.headers['user-agent'] || 'unknown';
    const currentFingerprint = crypto.createHash('sha256').update(currentUserAgent).digest('hex');

    if (decoded.fingerprint && decoded.fingerprint !== currentFingerprint) {
      console.warn(`🚨 [SECURITY] Hijacking Detectado! IP: ${req.ip} tentou usar o Token de ${decoded.id}`);
      return res.status(401).json({ error: 'Falha na validação de segurança do dispositivo. Token revogado.' });
    }

    // Injetar dados do usuário na requisição para o RBAC ou Controllers
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
};
