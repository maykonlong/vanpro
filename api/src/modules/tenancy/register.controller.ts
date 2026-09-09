import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { runUnscoped } from '../../lib/request-context';
import { validate, emailField, documentField, strongPassword, text } from '../../http/validate';
import { publicWriteLimiter } from '../../security/rate-limit';
import { issueSession } from '../auth/session.service';
import { issueCsrfToken } from '../../security/csrf';

/**
 * GUARDA: rota-publica-intencional
 *
 * Cadastro self-service: a empresa ainda nao existe quando esta rota
 * responde, entao nao ha papel a exigir. Protegida por publicWriteLimiter e
 * por mensagem generica de colisao.
 */

/**
 * Cadastro self-service da empresa.
 *
 * Unica rota de escrita do sistema que roda SEM `authenticate`: nao existe
 * usuario nem tenant antes dela. Por isso tudo aqui e feito dentro de
 * `runUnscoped` — o guard do Prisma exige tenant no contexto e, sem a
 * liberacao explicita, a criacao do vinculo nem chegaria ao banco.
 */

const router = Router();

const TRIAL_DAYS = 7;
const PLANO_INICIAL = 'FREE';

/**
 * Mensagem unica para e-mail e CNPJ ja usados.
 *
 * Dizer qual dos dois colidiu transforma o cadastro publico em oraculo: com
 * uma lista de CNPJs qualquer um descobre quais empresas usam o sistema, e com
 * uma lista de e-mails, quem tem conta. O custo e um cadastro legitimo que
 * precisa de suporte; o beneficio e nao entregar a base de clientes de graca.
 */
const COLISAO = 'Não foi possível concluir o cadastro com esses dados.';

const registerSchema = z.object({
  companyName: text(120, 'Nome da empresa'),
  document: documentField,
  ownerName: text(120, 'Nome do responsável'),
  ownerEmail: emailField,
  ownerPassword: strongPassword,
});

router.post(
  '/',
  publicWriteLimiter,
  validate({ body: registerSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof registerSchema>;

    const resultado = await runUnscoped('self-register', async () => {
      const [emailEmUso, documentoEmUso] = await Promise.all([
        prisma.user.findUnique({ where: { email: data.ownerEmail }, select: { id: true } }),
        prisma.company.findUnique({ where: { document: data.document }, select: { id: true } }),
      ]);
      if (emailEmUso || documentoEmUso) throw Errors.conflict(COLISAO);

      const plano = await prisma.subscriptionPlan.findUnique({
        where: { name: PLANO_INICIAL },
        select: { id: true },
      });
      // Plano ausente e falha de provisionamento do ambiente, nao do cliente.
      // Criar o plano aqui esconderia um seed que nao rodou e deixaria cada
      // ambiente com um "FREE" de limites diferentes.
      if (!plano) {
        logger.error({ plano: PLANO_INICIAL }, 'plano inicial ausente: rode o seed antes de aceitar cadastros');
        throw Errors.internal(`Plano "${PLANO_INICIAL}" não provisionado neste ambiente.`);
      }

      const senhaHash = await bcrypt.hash(data.ownerPassword, 12);
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      return prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: data.companyName,
            document: data.document,
            subscriptionId: plano.id,
            tenantStatus: 'TRIAL',
            trialEndsAt,
          },
          select: { id: true, name: true, trialEndsAt: true },
        });

        const user = await tx.user.create({
          data: {
            name: data.ownerName,
            email: data.ownerEmail,
            password: senhaHash,
            role: 'OWNER',
            tenantId: company.id,
            isActive: true,
          },
          select: { id: true, name: true, email: true, role: true, tenantId: true },
        });

        await tx.userCompany.create({
          data: {
            userId: user.id,
            companyId: company.id,
            role: 'OWNER',
            status: 'ACTIVE',
            contractType: 'FULL_TIME',
            canManageFinance: true,
            canManageHR: true,
            canManageRoutes: true,
          },
        });

        return { company, user };
      });
    });

    await issueSession(req, res, {
      id: resultado.user.id,
      role: resultado.user.role,
      tenantId: resultado.user.tenantId,
    });
    const csrfToken = issueCsrfToken(res);

    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Empresa "${resultado.company.name}" cadastrada por auto-atendimento; usuário OWNER criado.`,
      companyId: resultado.company.id,
      userId: resultado.user.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // O access token vai apenas no cookie httpOnly. Devolve-lo no corpo
    // anularia a protecao contra XSS que o httpOnly existe para dar.
    res.status(201).json({
      user: {
        id: resultado.user.id,
        name: resultado.user.name,
        email: resultado.user.email,
        role: resultado.user.role,
        companyId: resultado.company.id,
        companyName: resultado.company.name,
      },
      csrfToken,
      trialEndsAt: resultado.company.trialEndsAt,
    });
  },
);

export default router;
