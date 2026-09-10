import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { runUnscoped } from '../../lib/request-context';
import { validate, pagination, paginate, skipTake, uuidParam, text } from '../../http/validate';
import { requireSuperAdmin } from '../../http/middlewares/authenticate';
import { revokeAllUserSessions } from '../auth/session.service';

/**
 * Console da plataforma.
 *
 * Existe por causa de uma incoerencia de dominio: o produto suspendia a frota
 * no fim do periodo de teste, mas nunca emitiu fatura do proprio plano — ou
 * seja, cortava o acesso por inadimplencia de um boleto que jamais chegou ao
 * cliente. Enquanto a cobranca recorrente do SaaS nao existir, o fim do teste e
 * AVISO (`PAST_DUE`, ver `jobs/index.ts`) e cortar acesso passa a ser um ATO
 * ADMINISTRATIVO: alguem da plataforma decide, assina com o proprio usuario e
 * escreve o motivo, que fica na trilha da empresa afetada.
 *
 * TODO o router e `requireSuperAdmin`. Ele cruza empresas por natureza, entao
 * cada consulta roda em `runUnscoped` com filtro explicito — nunca sem filtro.
 */

const router = Router();

/*
 * O guard aparece DUAS vezes de proposito, e nao por descuido.
 *
 * `router.use` protege o router inteiro — inclusive uma rota que alguem
 * acrescentar aqui amanha sem lembrar do papel. Mas middleware de router e
 * invisivel na declaracao da rota: some numa refatoracao e nenhuma linha da
 * rota muda, alem de o auditor estatico (`infra/scripts/audit-route-guards.mjs`)
 * nao conseguir enxerga-lo. Por isso cada rota tambem declara o proprio guard:
 * uma protege o que ainda vai existir, a outra fica onde os olhos e o script
 * procuram.
 */
router.use(requireSuperAdmin);

const ESTADOS = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const;

/** Lista das frotas com o estado da assinatura e o tamanho de cada uma. */
router.get('/companies', requireSuperAdmin, validate({ query: pagination }), async (req, res) => {
  const { page, perPage } = req.valid.query as { page: number; perPage: number };
  const { skip, take } = skipTake({ page, perPage });

  const [rows, total] = await runUnscoped('platform-companies', () =>
    Promise.all([
      prisma.company.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          document: true,
          tenantStatus: true,
          trialEndsAt: true,
          suspendedAt: true,
          createdAt: true,
          plan: { select: { name: true, priceCents: true } },
          _count: { select: { students: true, vehicles: true, drivers: true } },
        },
      }),
      prisma.company.count(),
    ]),
  );

  res.json(
    paginate(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        // Documento truncado: o console serve para decidir sobre a assinatura,
        // nao para virar uma lista de CNPJ exportavel.
        document: `***${c.document.slice(-4)}`,
        tenantStatus: c.tenantStatus,
        trialEndsAt: c.trialEndsAt,
        suspendedAt: c.suspendedAt,
        createdAt: c.createdAt,
        plan: c.plan.name,
        planPriceCents: c.plan.priceCents,
        counts: c._count,
      })),
      total,
      { page, perPage },
    ),
  );
});

const mudancaSchema = z.object({
  status: z.enum(ESTADOS),
  /**
   * Motivo obrigatorio, e com tamanho minimo de verdade.
   *
   * Uma decisao que tira uma frota inteira do ar precisa deixar por escrito o
   * porque. Campo opcional aqui viraria trilha cheia de mudancas sem
   * explicacao, que e o mesmo que trilha nenhuma na hora de responder ao
   * cliente que ligou perguntando o motivo.
   */
  reason: text(300, 'Motivo').pipe(z.string().min(10, 'Explique o motivo em pelo menos 10 caracteres.')),
});

/**
 * Muda o estado da assinatura de uma frota.
 *
 * Suspender NAO derruba as sessoes abertas: a conta suspensa continua lendo, e
 * o motorista continua batendo ponto (ver D-06). Cancelar derruba, porque ai a
 * relacao acabou.
 */
router.patch(
  '/companies/:id/status',
  requireSuperAdmin,
  validate({ params: uuidParam(), body: mudancaSchema }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { status, reason } = req.valid.body as z.infer<typeof mudancaSchema>;
    const auth = req.auth!;

    const empresa = await runUnscoped('platform-company', () =>
      prisma.company.findUnique({ where: { id }, select: { id: true, name: true, tenantStatus: true } }),
    );
    if (!empresa) throw Errors.notFound('Empresa');

    if (empresa.tenantStatus === status) {
      throw Errors.conflict(`A empresa já está em ${status}.`);
    }

    const atualizada = await runUnscoped('platform-company-status', () =>
      prisma.company.update({
        where: { id },
        data: {
          tenantStatus: status,
          // `suspendedAt` marca QUANDO o corte comecou; sair de SUSPENDED
          // precisa limpar, senao a data velha faz o proximo relatorio contar
          // como suspensa uma frota que voltou a operar.
          suspendedAt: status === 'SUSPENDED' ? new Date() : null,
        },
        select: { id: true, name: true, tenantStatus: true, suspendedAt: true },
      }),
    );

    if (status === 'CANCELED') {
      const vinculos = await runUnscoped('platform-company-users', () =>
        prisma.userCompany.findMany({ where: { companyId: id }, select: { userId: true } }),
      );
      for (const v of vinculos) await revokeAllUserSessions(v.userId);
    }

    // Auditado na trilha da EMPRESA AFETADA, e nao na da plataforma: quem
    // depois precisar explicar ao cliente por que ficou fora do ar procura no
    // historico dele, que e onde a pergunta nasce.
    await audit({
      action: 'COMPANY_STATUS_CHANGED',
      description: `Assinatura de "${empresa.name}" alterada de ${empresa.tenantStatus} para ${status}. Motivo: ${reason}`,
      companyId: id,
      userId: auth.userId,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.json(atualizada);
  },
);

export default router;
