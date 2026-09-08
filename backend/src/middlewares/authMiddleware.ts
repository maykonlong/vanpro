import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET || 'vanpro_secret';

  try {
    const decoded = jwt.verify(token, secret) as AuthenticatedUser;
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
