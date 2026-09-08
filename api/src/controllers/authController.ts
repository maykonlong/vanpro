import { Request, Response } from 'express';
import { prisma } from '../prisma';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // Simplificado para MVP/Fase 4 inicial sem bcrypt para facilitar dev local
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Gerar token simples por enquanto (Mock JWT)
    const token = `fake-jwt-token-${user.id}`;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao autenticar' });
  }
};
