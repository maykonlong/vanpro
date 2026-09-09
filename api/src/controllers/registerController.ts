import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * FASE 31 - Self-Service Sign Up
 * Endpoint público para o dono de van se cadastrar sozinho.
 * Cria a Company + User (OWNER) e inicia o Trial de 7 dias.
 */
export const selfRegister = async (req: Request, res: Response) => {
  try {
    const { companyName, document, ownerName, ownerEmail, ownerPassword } = req.body;

    // 1. Verificar se o e-mail ou CNPJ já existe
    const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'Este e-mail já está em uso.' });
    }

    const existingCompany = await prisma.company.findUnique({ where: { document } });
    if (existingCompany) {
      return res.status(400).json({ error: 'Este CNPJ/CPF já está cadastrado.' });
    }

    // 2. Buscar o plano FREE (ou criar se não existir)
    let freePlan = await prisma.subscriptionPlan.findFirst({ where: { name: 'FREE' } });
    if (!freePlan) {
      freePlan = await prisma.subscriptionPlan.create({
        data: { name: 'FREE', maxVehicles: 2, maxDrivers: 3, price: 0 }
      });
    }

    // 3. Calcular Trial de 7 dias
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    // 4. Hash da senha
    const passwordHash = await bcrypt.hash(ownerPassword, 12);

    // 5. Criar Company + User (OWNER) numa transação atômica
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName,
          document,
          subscriptionId: freePlan!.id,
          tenantStatus: 'TRIAL',
          trialEndsAt
        }
      });

      const user = await tx.user.create({
        data: {
          name: ownerName,
          email: ownerEmail,
          password: passwordHash,
          role: 'OWNER',
          tenantId: company.id,
          passwordUpdatedAt: new Date()
        }
      });

      // Criar o vínculo UserCompany (Multi-Tenant)
      await tx.userCompany.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: 'OWNER',
          status: 'ACTIVE'
        }
      });

      return { company, user };
    });

    // 6. Gerar JWT de acesso imediato (sem precisar fazer login separado)
    const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_vanpro_key_123';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const fingerprint = crypto.createHash('sha256').update(userAgent).digest('hex');

    const token = jwt.sign(
      { id: result.user.id, role: 'OWNER', tenantId: result.company.id, fingerprint },
      jwtSecret,
      { expiresIn: '1d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    logger.info(`[SELF-REGISTER] Nova empresa cadastrada: "${result.company.name}" (${result.company.id}). Trial até: ${trialEndsAt.toISOString()}`);

    res.status(201).json({
      message: `Bem-vindo ao VanPro! Seu período de teste de 7 dias começou agora.`,
      trialEndsAt,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: 'OWNER',
        token
      }
    });
  } catch (error) {
    logger.error(`Self Register Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao criar conta. Tente novamente.' });
  }
};
