import { Request, Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

// 1. Gerar Chave Secreta e QR Code (Setup Inicial)
export const generate2FA = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // Gera um segredo único para este usuário
    const secret = authenticator.generateSecret();
    
    // Cria a URI que o Google Authenticator entende (otpauth://totp/...)
    const otpauthUrl = authenticator.keyuri(user.email, 'VanPro SaaS', secret);
    
    // Converte a URI numa Imagem (Base64 QR Code) para o front-end exibir
    const qrCodeImage = await QRCode.toDataURL(otpauthUrl);

    // Salva o segredo no banco temporariamente (ainda não liga o 2FA até confirmar)
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret }
    });

    res.json({
      secret,
      qrCodeImage
    });
  } catch (error) {
    logger.error(`Generate 2FA Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao gerar QR Code do 2FA.' });
  }
};

// 2. Verificar e Ligar Definitivamente o 2FA
export const verifyAndEnable2FA = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { token } = req.body; // Código de 6 dígitos que o usuário digitou no celular

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });

    if (!dbUser || !dbUser.twoFactorSecret) {
      return res.status(400).json({ error: '2FA não foi iniciado. Gere o QR Code primeiro.' });
    }

    // Verifica se o código de 6 dígitos bate com o Segredo
    const isValid = authenticator.verify({
      token,
      secret: dbUser.twoFactorSecret
    });

    if (!isValid) {
      return res.status(401).json({ error: 'Código 2FA inválido.' });
    }

    // Liga definitivamente a chave
    await prisma.user.update({
      where: { id: user.id },
      data: { isTwoFactorEnabled: true }
    });

    logger.info(`O Usuário ${user.email} ativou o 2FA com sucesso.`);

    res.json({ message: 'Autenticação em Duas Etapas ativada com sucesso!' });
  } catch (error) {
    logger.error(`Verify 2FA Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao validar o 2FA.' });
  }
};

// 3. Login Híbrido (Senha Correta -> Pede 2FA -> Devolve JWT)
export const verify2FALogin = async (req: Request, res: Response) => {
  try {
    const { userId, token } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ error: '2FA não está configurado para esta conta.' });
    }

    const isValid = authenticator.verify({
      token,
      secret: user.twoFactorSecret
    });

    if (!isValid) {
      return res.status(401).json({ error: 'Código 2FA incorreto.' });
    }

    import('crypto').then(crypto => {
      import('jsonwebtoken').then(jwt => {
        const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const fingerprint = crypto.createHash('sha256').update(userAgent).digest('hex');
    
        const jwtToken = jwt.sign(
          { id: user.id, role: user.role, tenantId: user.tenantId, fingerprint },
          jwtSecret,
          { expiresIn: '1d' }
        );
    
        res.cookie('token', jwtToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000 
        });
    
        res.json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            token: jwtToken
          }
        });
      });
    });

  } catch (error) {
    logger.error(`Login 2FA Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao validar código.' });
  }
};
