import { Router } from 'express';
import { tenantId } from '../../lib/tenant';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { money, brlInput } from '../../lib/money';
import {
  validate,
  pagination,
  paginate,
  skipTake,
  uuidParam,
  shiftField,
  text,
} from '../../http/validate';
import { requireRole, requirePermission } from '../../http/middlewares/authenticate';
import { assertPlanLimit } from '../tenancy/plan-limits';

/**
 * Motoristas.
 *
 * Cadastro trabalhista: nunca ha hard delete, so arquivamento. Historico de
 * ponto e de diarias e a defesa da empresa em reclamacao trabalhista, e apagar
 * o motorista apagaria a base de calculo junto.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;

const statusField = z.enum(['ACTIVE', 'ARCHIVED']);

const createSchema = z.object({
  name: text(120, 'Nome do motorista'),
  shiftType: shiftField.default('MORNING'),
  dailyRate: brlInput,
  userId: z.string().uuid().nullish(),
});

// `status` fica de fora: arquivar tem rota propria, com efeito no vinculo.
const updateSchema = createSchema.partial();

const listQuery = pagination.extend({
  status: statusField.optional(),
  search: z.string().trim().max(80).optional(),
});

const earningsQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Informe o mês no formato YYYY-MM'),
});

type DriverRow = Awaited<ReturnType<typeof prisma.driver.findFirstOrThrow>>;

function serialize(d: DriverRow) {
  return {
    id: d.id,
    name: d.name,
    userId: d.userId,
    shiftType: d.shiftType,
    dailyRate: money(d.dailyRateCents),
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Janela [inicio, fim) do mes em UTC, para nao depender do fuso do servidor. */
function monthRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 1)),
  };
}

router.get(
  '/',
  requireRole(...GESTAO),
  validate({ query: listQuery }),
  async (req, res) => {
    const { page, perPage, status, search } = req.valid.query as z.infer<typeof listQuery>;

    const where: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.driver.findMany({ where, orderBy: { name: 'asc' }, ...skipTake({ page, perPage }) }),
      prisma.driver.count({ where }),
    ]);

    res.json(paginate(rows.map(serialize), total, { page, perPage }));
  },
);

router.get(
  '/:id',
  requireRole(...GESTAO),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const driver = await prisma.driver.findFirst({ where: { id: req.valid.params.id } });
    if (!driver) throw Errors.notFound('Motorista');
    res.json(serialize(driver));
  },
);

router.post(
  '/',
  requireRole(...GESTAO),
  requirePermission('canManageHR'),
  validate({ body: createSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createSchema>;
    const auth = req.auth!;

    await assertPlanLimit(auth.tenantId!, 'drivers');

    if (data.userId) {
      const user = await prisma.user.findFirst({
        where: { id: data.userId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!user) throw Errors.notFound('Usuário');
    }

    // `userId` e unico globalmente: se ja houver motorista vinculado a esse
    // usuario, o P2002 vira 409 no handler global.
    const driver = await prisma.driver.create({
      data: {
        companyId: tenantId(),
        name: data.name,
        shiftType: data.shiftType,
        dailyRateCents: data.dailyRate,
        userId: data.userId ?? null,
      },
    });

    await audit({
      action: 'DRIVER_CREATED',
      description: `Motorista cadastrado (id ${driver.id}) no turno ${driver.shiftType}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serialize(driver));
  },
);

router.patch(
  '/:id',
  requireRole(...GESTAO),
  requirePermission('canManageHR'),
  validate({ params: uuidParam(), body: updateSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof updateSchema>;
    const id = req.valid.params.id as string;
    const auth = req.auth!;

    const existing = await prisma.driver.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Motorista');

    if (data.userId) {
      const user = await prisma.user.findFirst({
        where: { id: data.userId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!user) throw Errors.notFound('Usuário');
    }

    const driver = await prisma.driver.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.shiftType !== undefined ? { shiftType: data.shiftType } : {}),
        ...(data.dailyRate !== undefined ? { dailyRateCents: data.dailyRate } : {}),
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
      },
    });

    await audit({
      action: 'DRIVER_UPDATED',
      description: `Motorista ${id} atualizado. Campos: ${Object.keys(data).join(', ') || 'nenhum'}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(driver));
  },
);

/**
 * Desligamento. Nao existe exclusao: o cadastro vira somente-leitura.
 * O vinculo (`UserCompany`) tambem vai para ARCHIVED, senao a pessoa continuaria
 * com sessao valida e poder de escrita depois de desligada — o `requireRole` le
 * exatamente esse status para travar a escrita e liberar so a consulta.
 */
router.post(
  '/:id/archive',
  requireRole(...GESTAO),
  requirePermission('canManageHR'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.driver.findFirst({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!existing) throw Errors.notFound('Motorista');
    if (existing.status === 'ARCHIVED') {
      throw Errors.conflict('Este motorista já está arquivado.');
    }

    const abertos = await prisma.timecard.count({ where: { driverId: id, status: 'IN_PROGRESS' } });
    if (abertos > 0) {
      throw Errors.conflict(
        `Este motorista tem ${abertos} cartão(ões) de ponto em aberto. ` +
          `Encerre o turno antes de arquivar, senão a jornada fica sem hora de saída.`,
      );
    }

    const driver = await prisma.driver.update({ where: { id }, data: { status: 'ARCHIVED' } });

    if (existing.userId) {
      // updateMany (e nao update) porque o guard de tenant injeta o companyId no
      // where, e a chave unica do vinculo e o par (userId, companyId).
      await prisma.userCompany.updateMany({
        where: { userId: existing.userId },
        data: { status: 'ARCHIVED', leftAt: new Date() },
      });
    }

    await audit({
      action: 'DRIVER_ARCHIVED',
      description:
        `Motorista ${id} arquivado (somente leitura).` +
        (existing.userId ? ` Vínculo do usuário ${existing.userId} arquivado junto.` : ''),
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(driver));
  },
);

/**
 * Holerite do motorista: diarias do mes + fretamentos que ele atendeu.
 *
 * ISOLAMENTO: um DRIVER so enxerga o proprio holerite, e o proprio cadastro e
 * descoberto pelo `userId` da sessao — nunca pelo id que veio na URL. Pedir o
 * holerite de outro devolve 404, e nao 403, porque 403 confirmaria que aquele
 * motorista existe naquela empresa.
 *
 * O retorno traz remuneracao, nunca receita: o preco do fretamento e
 * faturamento da empresa e fica de fora de proposito.
 */
router.get(
  '/:id/earnings',
  requireRole('OWNER', 'MANAGER', 'DRIVER'),
  validate({ params: uuidParam(), query: earningsQuery }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { month } = req.valid.query as z.infer<typeof earningsQuery>;
    const auth = req.auth!;

    if (auth.role === 'DRIVER') {
      const self = await prisma.driver.findFirst({
        where: { userId: auth.userId },
        select: { id: true },
      });
      if (!self || self.id !== id) throw Errors.notFound('Motorista');
    }

    const driver = await prisma.driver.findFirst({
      where: { id },
      select: { id: true, name: true, dailyRateCents: true },
    });
    if (!driver) throw Errors.notFound('Motorista');

    const { start, end } = monthRange(month);

    const [workedDays, charters] = await Promise.all([
      prisma.timecard.count({
        where: { driverId: id, status: 'COMPLETED', date: { gte: start, lt: end } },
      }),
      prisma.charter.findMany({
        where: { driverId: id, startDate: { gte: start, lt: end } },
        orderBy: { startDate: 'asc' },
        select: { id: true, title: true, startDate: true, endDate: true, status: true },
      }),
    ]);

    const totalCents = workedDays * driver.dailyRateCents;

    res.json({
      driver: { id: driver.id, name: driver.name },
      month,
      dailyRate: money(driver.dailyRateCents),
      workedDays,
      dailies: money(totalCents),
      total: money(totalCents),
      charters: charters.map((c) => ({
        id: c.id,
        title: c.title,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
      })),
    });
  },
);

export default router;
