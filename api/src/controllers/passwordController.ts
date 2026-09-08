import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// 1. Esqueci Minha Senha (Gera Token)
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Retornar 200 sempre para não revelar (Email Enumeration Mitigation)
      return res.json({ message: 'Se o e-mail existir, um link de recuperação foi enviado.' });
    }

    // Criar Token de 15 minutos
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        token: resetToken,
        expiresAt,
        userId: user.id
      }
    });

    // AQUI: Integramos com um Worker (BullMQ) para enviar e-mail via SES / Resend.
    // Como Mock para testes, jogamos no Log Forense:
    logger.info(`[WORKER-MOCK] E-mail de Recuperação enviado para ${email}. Token: ${resetToken}`);

    res.json({ message: 'Se o e-mail existir, um link de recuperação foi enviado.' });
  } catch (error) {
    logger.error(`Forgot Password Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao processar solicitação.' });
  }
};

// 2. Redefinir Senha
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true }
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Token inválido ou expirado.' });
    }

    // Hash da nova senha
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atualiza a senha E a data de validade da senha (reseta os 90 dias)
    await prisma.user.update({
      where: { id: resetRecord.userId },
      data: {
        password: passwordHash,
        passwordUpdatedAt: new Date(),
        // Limpa desafios antigos por segurança
        currentChallenge: null
      }
    });

    // Invalida o token usado
    await prisma.passwordResetToken.delete({ where: { token } });

    logger.info(`Senha redefinida com sucesso para o usuário ${resetRecord.userId}`);

    res.json({ message: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (error) {
    logger.error(`Reset Password Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao redefinir a senha.' });
  }
};
