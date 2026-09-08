import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
    const token = jwt.sign(
      { id: user.id, role: user.role, tenantId: user.tenantId },
      jwtSecret,
      { expiresIn: '1d' }
    );

    // Cookie Seguro (HttpOnly)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 1 dia
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        // Mantemos o token no JSON apenas pro MVP transicional do React (Phase 3 resolverá isso no Front)
        token
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao autenticar' });
  }
};

export const verifySession = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
    const decoded = jwt.verify(token, jwtSecret) as { id: string };

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.json({ success: true });
};
