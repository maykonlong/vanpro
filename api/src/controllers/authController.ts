import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { 
  generateRegistrationOptions, 
  verifyRegistrationResponse, 
  generateAuthenticationOptions, 
  verifyAuthenticationResponse 
} from '@simplewebauthn/server';

const rpName = 'VanPro Elite SaaS';
const rpID = 'localhost'; // Em produção deve ser vanpro.com.br
const origin = `http://${rpID}:5173`;

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
    
    // Gerar Fingerprint (Blindagem contra roubo de Token)
    const userAgent = req.headers['user-agent'] || 'unknown';
    const fingerprint = crypto.createHash('sha256').update(userAgent).digest('hex');

    const token = jwt.sign(
      { id: user.id, role: user.role, tenantId: user.tenantId, fingerprint },
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
    const decoded = jwt.verify(token, jwtSecret) as { id: string, fingerprint?: string };

    // Validação de Segurança Máxima: Checar DNA do Navegador (User-Agent)
    const currentUserAgent = req.headers['user-agent'] || 'unknown';
    const currentFingerprint = crypto.createHash('sha256').update(currentUserAgent).digest('hex');

    if (decoded.fingerprint && decoded.fingerprint !== currentFingerprint) {
      console.warn(`🚨 [SECURITY] Tentativa de Roubo de Sessão Detectada! User ID: ${decoded.id}`);
      return res.status(401).json({ error: 'Falha na validação de segurança do dispositivo.' });
    }

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

// ========================================================
// WEBAUTHN (BIOMETRIA / PASSKEYS)
// ========================================================

// 1. Gera as opções de cadastro da digital (Para usuários já logados)
export const generateRegistrationOptionsHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user; // Injetado pelo authMiddleware
    
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { authenticators: true }
    });

    if (!dbUser) return res.status(404).json({ error: "Usuário não encontrado" });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from(dbUser.id)),
      userName: dbUser.email,
      // Não pedir PIN, preferir biometria local
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: dbUser.authenticators.map(auth => ({
        id: new Uint8Array(auth.credentialID), // Convert from Prisma Bytes
        type: 'public-key',
      }))
    });

    // Salvar o challenge no banco de dados para conferir depois
    await prisma.user.update({
      where: { id: user.id },
      data: { currentChallenge: options.challenge }
    });

    res.json(options);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// 2. Valida o cadastro e salva a Chave Pública no Banco
export const verifyRegistrationResponseHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = req.body;

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.currentChallenge) {
      return res.status(400).json({ error: "Challenge não encontrado" });
    }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: dbUser.currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    const { verified, registrationInfo } = verification;

    if (verified && registrationInfo) {
      const { credentialPublicKey, credentialID, counter, credentialDeviceType, credentialBackedUp } = registrationInfo;

      await prisma.authenticator.create({
        data: {
          credentialID: Buffer.from(credentialID),
          credentialPublicKey: Buffer.from(credentialPublicKey),
          counter: BigInt(counter),
          credentialDeviceType,
          credentialBackedUp,
          userId: user.id
        }
      });

      // Limpar o challenge
      await prisma.user.update({
        where: { id: user.id },
        data: { currentChallenge: null }
      });

      res.json({ success: true, message: "Biometria ativada com sucesso!" });
    } else {
      res.status(400).json({ error: "Falha na validação biométrica" });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// 3. Gerar o Desafio de Login para quem abriu o App deslogado
export const generateAuthenticationOptionsHandler = async (req: Request, res: Response) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    // Como o usuário não está logado, guardamos o challenge na Sessão/Memória (aqui faremos um workaround no DB para o MVP)
    // Num fluxo perfeito de WebAuthn, o ID do usuário pode não vir, então o Challenge pode ir no Cookie de transição
    res.cookie('webauthnChallenge', options.challenge, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 5 * 60 * 1000 });

    res.json(options);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// 4. Receber a digital lida pelo celular e gerar o JWT Real
export const verifyAuthenticationResponseHandler = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const expectedChallenge = req.cookies.webauthnChallenge;

    if (!expectedChallenge) return res.status(400).json({ error: "Challenge expirado ou inválido" });

    // O Frontend WebAuthn manda a ID da credencial que foi usada
    const authenticator = await prisma.authenticator.findUnique({
      where: { credentialID: Buffer.from(body.id, 'base64url') }, // No Node 20 / simplewebauthn, o id vem como base64url
      include: { user: true }
    });

    if (!authenticator) {
      return res.status(404).json({ error: "Credencial biométrica não registrada neste sistema." });
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: new Uint8Array(authenticator.credentialID),
        credentialPublicKey: new Uint8Array(authenticator.credentialPublicKey),
        counter: Number(authenticator.counter),
      }
    });

    const { verified, authenticationInfo } = verification;

    if (verified) {
      // Atualizar o counter anti-replay no banco
      await prisma.authenticator.update({
        where: { id: authenticator.id },
        data: { counter: BigInt(authenticationInfo.newCounter) }
      });

      // Gerar Token JWT Igual ao Login Convencional (Com Fingerprint!)
      const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
      const userAgent = req.headers['user-agent'] || 'unknown';
      const fingerprint = crypto.createHash('sha256').update(userAgent).digest('hex');

      const token = jwt.sign(
        { id: authenticator.user.id, role: authenticator.user.role, tenantId: authenticator.user.tenantId, fingerprint },
        jwtSecret,
        { expiresIn: '1d' }
      );

      res.clearCookie('webauthnChallenge');
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 
      });

      res.json({
        success: true,
        user: {
          id: authenticator.user.id,
          name: authenticator.user.name,
          email: authenticator.user.email,
          role: authenticator.user.role,
          token
        }
      });
    } else {
      res.status(401).json({ error: "Assinatura biométrica inválida." });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
