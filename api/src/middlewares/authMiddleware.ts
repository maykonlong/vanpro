import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
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

    // FASE 31: Verificar se a empresa está SUSPENSA (Trial expirado ou inadimplência)
    // Super Admin nunca é bloqueado
    if (decoded.role !== 'SUPER_ADMIN' && decoded.tenantId) {
      const company = await prisma.company.findUnique({
        where: { id: decoded.tenantId },
        select: { tenantStatus: true, name: true }
      });

      if (company?.tenantStatus === 'SUSPENDED') {
        return res.status(402).json({
          error: 'Conta suspensa.',
          errorCode: 'ACCOUNT_SUSPENDED',
          message: `A conta da empresa "${company.name}" está suspensa. Entre em contato para reativar seu plano.`
        });
      }
    }

    // Injetar dados do usuário na requisição para o RBAC ou Controllers
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
};
