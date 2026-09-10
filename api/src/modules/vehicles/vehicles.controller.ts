import { Router } from 'express';
import { tenantId } from '../../lib/tenant';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import {
  validate,
  pagination,
  paginate,
  skipTake,
  uuidParam,
  plateField,
} from '../../http/validate';
import { requireRole, requirePermission } from '../../http/middlewares/authenticate';
import { assertPlanLimit } from '../tenancy/plan-limits';

/**
 * Frota.
 *
 * Segue o molde de `students.controller.ts`: zod na fronteira, `requireRole`
 * em toda rota, filtro de empresa vindo do guard do Prisma, paginacao
 * obrigatoria, auditoria em toda escrita e serializador proprio.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;
const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

const statusField = z.enum(['IDLE', 'ON_ROUTE', 'MAINTENANCE']);

const createSchema = z.object({
  plate: plateField,
  model: z.string().trim().max(80).default(''),
  capacity: z.coerce.number().int().min(1, 'Capacidade mínima é 1').max(120),
  km: z.coerce.number().int().min(0).default(0),
  status: statusField.default('IDLE'),
});

// A quilometragem tem rota propria (`PATCH /:id/km`) porque a regra dela e
// diferente: so cresce, e o motorista tambem pode registrar.
const updateSchema = createSchema.partial().omit({ km: true });

const listQuery = pagination.extend({
  status: statusField.optional(),
  search: z.string().trim().max(80).optional(),
});

type VehicleRow = Awaited<ReturnType<typeof prisma.vehicle.findFirstOrThrow>>;

function serialize(v: VehicleRow) {
  return {
    id: v.id,
    plate: v.plate,
    model: v.model,
    capacity: v.capacity,
    km: v.km,
    status: v.status,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

router.get(
  '/',
  requireRole(...OPERACAO),
  validate({ query: listQuery }),
  async (req, res) => {
    const { page, perPage, status, search } = req.valid.query as z.infer<typeof listQuery>;

    const where: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { plate: { contains: search.toUpperCase(), mode: 'insensitive' as const } },
              { model: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.vehicle.findMany({ where, orderBy: { plate: 'asc' }, ...skipTake({ page, perPage }) }),
      prisma.vehicle.count({ where }),
    ]);

    res.json(paginate(rows.map(serialize), total, { page, perPage }));
  },
);

router.get(
  '/:id',
  requireRole(...OPERACAO),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: req.valid.params.id } });
    if (!vehicle) throw Errors.notFound('Veículo');
    res.json(serialize(vehicle));
  },
);

router.post(
  '/',
  requireRole(...GESTAO),
  requirePermission('canManageRoutes'),
  validate({ body: createSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createSchema>;
    const auth = req.auth!;

    await assertPlanLimit(auth.tenantId!, 'vehicles');

    // Placa duplicada dentro da empresa e barrada pelo @@unique([companyId, plate]);
    // o P2002 vira 409 no handler global, entao nao ha checagem manual (que teria
    // corrida entre o SELECT e o INSERT de qualquer jeito).
    const vehicle = await prisma.vehicle.create({
      data: {
        companyId: tenantId(),
        plate: data.plate,
        model: data.model,
        capacity: data.capacity,
        km: data.km,
        status: data.status,
      },
    });

    await audit({
      action: 'VEHICLE_CREATED',
      description: `Veículo ${vehicle.plate} cadastrado (id ${vehicle.id}).`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serialize(vehicle));
  },
);

router.patch(
  '/:id',
  requireRole(...GESTAO),
  requirePermission('canManageRoutes'),
  validate({ params: uuidParam(), body: updateSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof updateSchema>;
    const id = req.valid.params.id as string;

    const existing = await prisma.vehicle.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Veículo');

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(data.plate !== undefined ? { plate: data.plate } : {}),
        ...(data.model !== undefined ? { model: data.model } : {}),
        ...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });

    await audit({
      action: 'VEHICLE_UPDATED',
      description: `Veículo ${id} atualizado. Campos: ${Object.keys(data).join(', ') || 'nenhum'}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(vehicle));
  },
);

/**
 * Odometro. O motorista registra, porque quem le o painel e ele.
 * Km e monotonico: aceitar valor menor que o atual apagaria a base de rateio de
 * combustivel e manutencao, e e o jeito mais facil de esconder uso do veiculo.
 */
router.patch(
  '/:id/km',
  requireRole('OWNER', 'MANAGER', 'DRIVER'),
  validate({
    params: uuidParam(),
    body: z.object({ km: z.coerce.number().int().min(0).max(9_999_999) }),
  }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { km } = req.valid.body as { km: number };

    const existing = await prisma.vehicle.findFirst({ where: { id }, select: { id: true, km: true } });
    if (!existing) throw Errors.notFound('Veículo');

    if (km < existing.km) {
      throw Errors.conflict(
        `A quilometragem informada (${km} km) é menor que a registrada (${existing.km} km). ` +
          `O odômetro só avança. Se houve erro de digitação anterior, abra um chamado para correção.`,
      );
    }

    const vehicle = await prisma.vehicle.update({ where: { id }, data: { km } });

    await audit({
      action: 'VEHICLE_UPDATED',
      description: `Quilometragem do veículo ${id} de ${existing.km} para ${km} km.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(vehicle));
  },
);

/**
 * Exclusao logica. Hard delete levaria junto o vinculo de despesas, fretamentos
 * e cartoes de ponto ja emitidos — historico que a empresa precisa guardar.
 */
router.delete(
  '/:id',
  requireRole('OWNER'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.vehicle.findFirst({ where: { id }, select: { id: true, plate: true } });
    if (!existing) throw Errors.notFound('Veículo');

    const [charters, timecards] = await Promise.all([
      prisma.charter.count({ where: { vehicleId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      prisma.timecard.count({ where: { vehicleId: id, status: 'IN_PROGRESS' } }),
    ]);

    if (charters > 0) {
      throw Errors.conflict(
        `Este veículo tem ${charters} fretamento(s) pendente(s) ou em andamento. ` +
          `Conclua ou cancele antes de remover.`,
      );
    }
    if (timecards > 0) {
      throw Errors.conflict(
        `Este veículo tem ${timecards} cartão(ões) de ponto em aberto. ` +
          `Encerre o turno antes de remover.`,
      );
    }

    await prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });

    await audit({
      action: 'VEHICLE_DELETED',
      description: `Veículo ${existing.plate} (${id}) removido (exclusão lógica).`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

export default router;
