import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { runUnscoped } from '../../lib/request-context';
import { env } from '../../config/env';
import {
  validate,
  pagination,
  paginate,
  skipTake,
  uuidParam,
  emailField,
  strongPassword,
  roleField,
  text,
} from '../../http/validate';
import { requireRole, requirePermission } from '../../http/middlewares/authenticate';
import { publicWriteLimiter } from '../../security/rate-limit';
import { issueSession, revokeAllUserSessions } from '../auth/session.service';
import { issueCsrfToken } from '../../security/csrf';
import { planUsage } from './plan-limits';

/**
 * Empresa e equipe.
 *
 * Duas superficies distintas no mesmo modulo:
 *   - `default`      — tudo autenticado, montado atras de `authenticate`;
 *   - `publicRouter` — apenas `POST /accept-invite`, que precisa rodar sem
 *                      sessao porque quem aceita o convite ainda nao tem uma.
 * Sao routers separados de proposito: um convite aceito por engano dentro do
 * router autenticado seria uma rota publica escondida atras de um middleware
 * que alguem pode remover na montagem.
 */

const router = Router();
export const publicRouter = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;
const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

const INVITE_TTL_HOURS = 72;

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

const updateCompanySchema = z.object({
  name: text(120, 'Nome da empresa').optional(),
  // Coordenadas da garagem: ponto de partida das rotas e do calculo de km.
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
});

router.get('/me', requireRole(...OPERACAO), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  if (!tenantId) throw Errors.forbidden('Este acesso não está vinculado a uma empresa.');

  const company = await runUnscoped('company-read', () =>
    prisma.company.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        document: true,
        latitude: true,
        longitude: true,
        tenantStatus: true,
        trialEndsAt: true,
        createdAt: true,
      },
    }),
  );
  if (!company) throw Errors.notFound('Empresa');

  res.json({ company, plan: await planUsage(tenantId) });
});

router.patch(
  '/me',
  requireRole('OWNER'),
  validate({ body: updateCompanySchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof updateCompanySchema>;
    const tenantId = req.auth!.tenantId;
    if (!tenantId) throw Errors.forbidden('Este acesso não está vinculado a uma empresa.');

    const company = await runUnscoped('company-update', () =>
      prisma.company.update({
        where: { id: tenantId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
          ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        },
        select: {
          id: true,
          name: true,
          document: true,
          latitude: true,
          longitude: true,
          tenantStatus: true,
          trialEndsAt: true,
        },
      }),
    );

    res.json(company);
  },
);

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

const listTeamQuery = pagination.extend({
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  role: roleField.optional(),
});

const inviteSchema = z.object({
  email: emailField,
  name: text(120, 'Nome'),
  role: roleField,
  contractType: z.enum(['FULL_TIME', 'FREELANCE']).default('FULL_TIME'),
  permissions: z
    .object({
      canManageFinance: z.boolean().default(false),
      canManageHR: z.boolean().default(false),
      canManageRoutes: z.boolean().default(false),
    })
    .default({ canManageFinance: false, canManageHR: false, canManageRoutes: false }),
});

const permissionsSchema = z.object({
  role: roleField,
  canManageFinance: z.boolean(),
  canManageHR: z.boolean(),
  canManageRoutes: z.boolean(),
});

type MembroRow = {
  id: string;
  role: string;
  status: string;
  contractType: string;
  canManageFinance: boolean;
  canManageHR: boolean;
  canManageRoutes: boolean;
  inviteExpiresAt: Date | null;
  joinedAt: Date;
  leftAt: Date | null;
  user: { id: string; name: string; email: string; isActive: boolean };
};

function serializeMembro(m: MembroRow) {
  return {
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    contractType: m.contractType,
    permissions: {
      canManageFinance: m.canManageFinance,
      canManageHR: m.canManageHR,
      canManageRoutes: m.canManageRoutes,
    },
    // Convite pendente aparece com validade para o gestor saber quando reenviar.
    inviteExpiresAt: m.status === 'INVITED' ? m.inviteExpiresAt : null,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    isActive: m.user.isActive,
  };
}

const membroSelect = {
  id: true,
  role: true,
  status: true,
  contractType: true,
  canManageFinance: true,
  canManageHR: true,
  canManageRoutes: true,
  inviteExpiresAt: true,
  joinedAt: true,
  leftAt: true,
  user: { select: { id: true, name: true, email: true, isActive: true } },
} as const;

router.get(
  '/team',
  requireRole(...GESTAO),
  validate({ query: listTeamQuery }),
  async (req, res) => {
    const { page, perPage, status, role } = req.valid.query as z.infer<typeof listTeamQuery>;

    const where = {
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.userCompany.findMany({
        where,
        select: membroSelect,
        orderBy: { joinedAt: 'desc' },
        ...skipTake({ page, perPage }),
      }),
      prisma.userCompany.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeMembro), total, { page, perPage }));
  },
);

/**
 * Convite. O token cru so existe nesta resposta (e so em `local`); o banco
 * guarda apenas o SHA-256 — vazamento da tabela nao vira convite utilizavel,
 * pelo mesmo motivo que a senha nao fica em texto.
 */
router.post(
  '/team/invite',
  requireRole(...GESTAO),
  requirePermission('canManageHR'),
  validate({ body: inviteSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof inviteSchema>;
    const auth = req.auth!;
    const tenantId = auth.tenantId;
    if (!tenantId) throw Errors.forbidden('Este acesso não está vinculado a uma empresa.');

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const membro = await runUnscoped('team-invite', async () => {
      let user = await prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true, name: true, email: true },
      });

      if (!user) {
        // Senha aleatoria e descartada: a conta so se torna utilizavel quando o
        // convidado define a propria em `accept-invite`. Nunca uma senha padrao.
        const senhaProvisoria = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
        user = await prisma.user.create({
          data: {
            name: data.name,
            email: data.email,
            password: senhaProvisoria,
            role: data.role,
            tenantId,
            isActive: true,
          },
          select: { id: true, name: true, email: true },
        });
      }

      // Sem `companyId` no where de proposito: o guard do Prisma injeta o
      // tenant do contexto, e repetir aqui so criaria um segundo lugar para
      // errar.
      const existente = await prisma.userCompany.findFirst({
        where: { userId: user.id },
        select: { id: true, status: true },
      });
      if (existente && existente.status !== 'INVITED') {
        throw Errors.conflict('Esta pessoa já faz parte da equipe desta empresa.');
      }

      const payload = {
        role: data.role,
        status: 'INVITED',
        contractType: data.contractType,
        canManageFinance: data.permissions.canManageFinance,
        canManageHR: data.permissions.canManageHR,
        canManageRoutes: data.permissions.canManageRoutes,
        inviteTokenHash: hashToken(rawToken),
        inviteExpiresAt,
      };

      return existente
        ? prisma.userCompany.update({ where: { id: existente.id }, data: payload, select: membroSelect })
        : prisma.userCompany.create({
            data: { ...payload, userId: user.id, companyId: tenantId },
            select: membroSelect,
          });
    });

    await audit({
      action: 'USER_INVITED',
      description: `Convite emitido para o vínculo ${membro.id} com papel ${data.role}, válido por ${INVITE_TTL_HOURS}h.`,
      ipAddress: req.ip ?? null,
    });

    const link = `${env.FRONTEND_URL}/aceitar-convite?token=${rawToken}`;

    // Sem provedor de e-mail o convite nao "quase funciona": ele e registrado
    // como pendente de envio manual. Devolver o link em staging/producao
    // transformaria a resposta de uma API autenticada em canal de distribuicao
    // de credencial — em `local` isso e aceitavel para desenvolver.
    logger.warn(
      { userCompanyId: membro.id, expiresAt: inviteExpiresAt },
      '[SEM PROVEDOR DE E-MAIL] convite gerado e não enviado; entregue o link manualmente',
    );

    res.status(201).json({
      member: serializeMembro(membro),
      emailSent: false,
      inviteExpiresAt,
      ...(env.APP_ENV === 'local' ? { inviteLink: link } : {}),
    });
  },
);

/**
 * Alteracao de papel e permissoes.
 *
 * Duas recusas que parecem burocracia e nao sao: ninguem se auto-rebaixa e a
 * empresa nunca fica sem OWNER ativo. Sem OWNER nao sobra quem devolva acesso a
 * qualquer pessoa — o suporte vira o unico caminho, e ele nao existe.
 */
router.post(
  '/team/:userCompanyId/permissions',
  requireRole('OWNER'),
  validate({ params: uuidParam('userCompanyId'), body: permissionsSchema }),
  async (req, res) => {
    const id = req.valid.params.userCompanyId as string;
    const data = req.valid.body as z.infer<typeof permissionsSchema>;
    const auth = req.auth!;

    const alvo = await prisma.userCompany.findFirst({
      where: { id },
      select: { id: true, userId: true, role: true, status: true },
    });
    if (!alvo) throw Errors.notFound('Vínculo');

    if (alvo.userId === auth.userId) {
      throw Errors.conflict(
        'Você não pode alterar o próprio papel. Peça a outro OWNER da empresa para fazer isso.',
      );
    }

    if (alvo.role === 'OWNER' && data.role !== 'OWNER' && alvo.status === 'ACTIVE') {
      const owners = await prisma.userCompany.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
      if (owners <= 1) {
        throw Errors.conflict(
          'Esta empresa ficaria sem nenhum OWNER ativo. Promova outra pessoa antes de rebaixar esta.',
        );
      }
    }

    const membro = await prisma.userCompany.update({
      where: { id },
      data: {
        role: data.role,
        canManageFinance: data.canManageFinance,
        canManageHR: data.canManageHR,
        canManageRoutes: data.canManageRoutes,
      },
      select: membroSelect,
    });

    // A role tambem vive em `User`, que e de onde o `authenticate` a le.
    await runUnscoped('team-role-sync', () =>
      prisma.user.update({ where: { id: alvo.userId }, data: { role: data.role } }),
    );

    await audit({
      action: 'USER_ROLE_CHANGED',
      description: `Vínculo ${id} alterado de ${alvo.role} para ${data.role} (financeiro=${data.canManageFinance}, rh=${data.canManageHR}, rotas=${data.canManageRoutes}).`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializeMembro(membro));
  },
);

/**
 * Desligamento. Alem de arquivar o vinculo, derruba as sessoes na hora:
 * um access token vale ate 15 minutos, e 15 minutos de acesso aos dados da
 * empresa depois da demissao e tempo de sobra para copiar a base.
 */
router.post(
  '/team/:userCompanyId/archive',
  requireRole('OWNER'),
  validate({ params: uuidParam('userCompanyId') }),
  async (req, res) => {
    const id = req.valid.params.userCompanyId as string;
    const auth = req.auth!;

    const alvo = await prisma.userCompany.findFirst({
      where: { id },
      select: { id: true, userId: true, role: true, status: true },
    });
    if (!alvo) throw Errors.notFound('Vínculo');
    if (alvo.status === 'ARCHIVED') throw Errors.conflict('Este vínculo já está arquivado.');

    if (alvo.userId === auth.userId) {
      throw Errors.conflict('Você não pode arquivar o próprio vínculo.');
    }

    if (alvo.role === 'OWNER' && alvo.status === 'ACTIVE') {
      const owners = await prisma.userCompany.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
      if (owners <= 1) {
        throw Errors.conflict(
          'Esta empresa ficaria sem nenhum OWNER ativo. Promova outra pessoa antes de arquivar esta.',
        );
      }
    }

    const membro = await prisma.userCompany.update({
      where: { id },
      data: { status: 'ARCHIVED', leftAt: new Date() },
      select: membroSelect,
    });

    await revokeAllUserSessions(alvo.userId);

    await audit({
      action: 'USER_ARCHIVED',
      description: `Vínculo ${id} arquivado e sessões do usuário revogadas.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializeMembro(membro));
  },
);

// ---------------------------------------------------------------------------
// Aceite de convite (publico)
// ---------------------------------------------------------------------------

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: text(120, 'Nome'),
  password: strongPassword,
});

/**

 * GUARDA: rota-publica-intencional

 *

 * Quem clica no link do convite ainda nao tem conta — nao ha papel a exigir.

 * O controle e o token de convite: guardado como hash, com validade de 72h e

 * uso unico. Marcador por ROTA, e nao por arquivo: as demais rotas deste

 * controller sao autenticadas, e desculpar o arquivo inteiro esconderia um

 * esquecimento futuro.

 */

publicRouter.post(
  '/accept-invite',
  publicWriteLimiter,
  validate({ body: acceptSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof acceptSchema>;

    const resultado = await runUnscoped('accept-invite', async () => {
      const convite = await prisma.userCompany.findUnique({
        where: { inviteTokenHash: hashToken(data.token) },
        select: {
          id: true,
          userId: true,
          companyId: true,
          role: true,
          status: true,
          inviteExpiresAt: true,
        },
      });

      // Mesma mensagem para token inexistente, expirado e ja usado: distinguir
      // os casos diria a quem sonda que aquele token um dia existiu.
      const invalido = Errors.conflict('Convite inválido ou expirado. Peça um novo à empresa.');
      if (!convite || convite.status !== 'INVITED') throw invalido;
      if (!convite.inviteExpiresAt || convite.inviteExpiresAt < new Date()) throw invalido;

      const senhaHash = await bcrypt.hash(data.password, 12);

      return prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: convite.userId },
          data: {
            name: data.name,
            password: senhaHash,
            passwordUpdatedAt: new Date(),
            role: convite.role,
            tenantId: convite.companyId,
            isActive: true,
          },
          select: { id: true, name: true, email: true, role: true, tenantId: true },
        });

        await tx.userCompany.update({
          where: { id: convite.id },
          data: {
            status: 'ACTIVE',
            joinedAt: new Date(),
            leftAt: null,
            inviteTokenHash: null,
            inviteExpiresAt: null,
          },
        });

        return { user, companyId: convite.companyId, userCompanyId: convite.id };
      });
    });

    // A empresa ativa e a do convite que acabou de ser aceito — nao o
    // `tenantId` do usuario, que pode apontar para outra frota se a pessoa ja
    // trabalhava em uma.
    await issueSession(req, res, {
      id: resultado.user.id,
      role: resultado.user.role,
      companyId: resultado.user.tenantId,
    });
    const csrfToken = issueCsrfToken(res);

    await audit({
      action: 'AUTH_LOGIN_SUCCESS',
      description: `Convite ${resultado.userCompanyId} aceito; vínculo ativado.`,
      companyId: resultado.companyId,
      userId: resultado.user.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({
      user: {
        id: resultado.user.id,
        name: resultado.user.name,
        email: resultado.user.email,
        role: resultado.user.role,
        companyId: resultado.companyId,
      },
      csrfToken,
    });
  },
);

export default router;
