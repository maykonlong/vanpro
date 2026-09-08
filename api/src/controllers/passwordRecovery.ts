import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { emailQueue } from '../jobs/emailQueue';
import { createAuditLog } from '../services/auditLogger';
import crypto from 'crypto';

export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email é obrigatório' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    
    // ATENÇÃO: Segurança (Timing Attack) - Não revelar se o email existe ou não
    if (user) {
      // Gera token temporário de 15 minutos (idealmente salvaríamos num banco ou Redis com TTL)
      const resetToken = crypto.randomBytes(32).toString('hex');
      // No cenário real: Redis.set(`reset:${resetToken}`, user.id, 'EX', 900)
      
      await emailQueue.add('send-recovery-email', {
        to: user.email,
        subject: 'Recuperação de Senha - VanPro SaaS',
        resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
      });

      await createAuditLog({
        userId: user.id,
        companyId: user.companyId || undefined,
        action: 'PASSWORD_RESET_REQUESTED',
        description: 'Usuário solicitou link de redefinição de senha',
        ipAddress: req.ip
      });
    }

    // Sempre retorna "Sucesso" para evitar vazamento de lista de e-mails (Email Enumeration Prevention)
    res.json({ message: 'Se o email existir, um link de recuperação foi enviado.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao processar recuperação.' });
  }
};
