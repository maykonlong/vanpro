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
  text,
} from '../../http/validate';
import { requireRole, requirePermission } from '../../http/middlewares/authenticate';

/**
 * Fretamento.
 *
 * Segue o molde de `students.controller.ts`. Duas regras dominam este modulo:
 * o preco e Int em centavos, e a escala de veiculo/motorista e verificada
 * dentro de transacao — agendar a mesma van em dois contratos ao mesmo tempo
 * e um prejuizo que so aparece na hora do embarque.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;
const LEITURA = ['OWNER', 'MANAGER', 'DRIVER'] as const;

const STATUS = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'] as const;
const statusField = z.enum(STATUS);

/** Contrato aberto: ocupa a agenda do veiculo e do motorista. */
const STATUS_QUE_OCUPAM_AGENDA = ['PENDING', 'IN_PROGRESS'] as const;

/**
 * Maquina de estados. Fora daqui nao existe transicao valida — mapa explicito
 * em vez de `if` espalhado, para que um estado novo obrigue a decidir de onde
 * ele pode ser alcancado.
 */
const TRANSICOES: Record<string, readonly string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

const MAX_DIAS = 60;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const periodoSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .superRefine((v, ctx) => {
    if (v.endDate <= v.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'A data final precisa ser posterior a data inicial',
      });
      return;
    }
    if (v.endDate.getTime() - v.startDate.getTime() > MAX_DIAS * MS_POR_DIA) {
      // Teto explicito: periodo de anos travaria a agenda do veiculo
      // indefinidamente e viraria bloqueio permanente por engano de digitacao.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `O fretamento não pode passar de ${MAX_DIAS} dias`,
      });
    }
  });

const createSchema = z
  .object({
    title: text(120, 'Título do fretamento'),
    contractor: text(160, 'Contratante'),
    price: brlInput,
  })
  .and(periodoSchema);

const updateSchema = z
  .object({
    title: text(120, 'Título do fretamento').optional(),
    contractor: text(160, 'Contratante').optional(),
    price: brlInput.optional(),
  })
  .and(periodoSchema);

const listQuery = pagination.extend({ status: statusField.optional() });

type CharterRow = Awaited<ReturnType<typeof prisma.charter.findFirstOrThrow>>;

function serialize(c: CharterRow) {
  return {
    id: c.id,
    title: c.title,
    contractor: c.contractor,
    price: money(c.priceCents),
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    vehicleId: c.vehicleId,
    driverId: c.driverId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Id do perfil de motorista do usuario logado.
 *
 * O DRIVER so enxerga fretamento atribuido a ele, e o vinculo esta em
 * `Driver.userId`, nao em `Charter.driverId` — sem essa traducao o filtro
 * compararia id de usuario com id de motorista e devolveria lista vazia
 * (ou, pior, nao filtraria nada).
 */
async function driverProfileId(userId: string): Promise<string | null> {
  const driver = await prisma.driver.findFirst({ where: { userId }, select: { id: true } });
  return driver?.id ?? null;
}

router.get(
  '/',
  requireRole(...LEITURA),
  validate({ query: listQuery }),
  async (req, res) => {
    const { page, perPage, status } = req.valid.query as z.infer<typeof listQuery>;
    const auth = req.auth!;

    let driverFilter: Record<string, unknown> = {};
    if (auth.role === 'DRIVER') {
      const id = await driverProfileId(auth.userId);
      // Motorista sem perfil cadastrado nao tem fretamento — `null` casaria com
      // os contratos ainda nao atribuidos, que nao sao dele.
      if (!id) return res.json(paginate([], 0, { page, perPage }));
      driverFilter = { driverId: id };
    }

    const where = { ...(status ? { status } : {}), ...driverFilter };

    const [rows, total] = await Promise.all([
      prisma.charter.findMany({ where, orderBy: { startDate: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.charter.count({ where }),
    ]);

    res.json(paginate(rows.map(serialize), total, { page, perPage }));
  },
);

router.get(
  '/:id',
  requireRole(...LEITURA),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const auth = req.auth!;
    const charter = await prisma.charter.findFirst({ where: { id: req.valid.params.id } });
    if (!charter) throw Errors.notFound('Fretamento');

    if (auth.role === 'DRIVER') {
      const id = await driverProfileId(auth.userId);
      if (!id || charter.driverId !== id) throw Errors.notFound('Fretamento');
    }

    res.json(serialize(charter));
  },
);

router.post(
  '/',
  requireRole(...GESTAO),
  requirePermission('canManageRoutes'),
  validate({ body: createSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createSchema>;

    const charter = await prisma.charter.create({
      data: {
        companyId: tenantId(),
        title: data.title,
        contractor: data.contractor,
        priceCents: data.price,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });

    await audit({
      action: 'CHARTER_CREATED',
      description: `Fretamento ${charter.id} criado para ${charter.contractor}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serialize(charter));
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

    const existing = await prisma.charter.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw Errors.notFound('Fretamento');
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELED') {
      throw Errors.conflict('Fretamento encerrado não pode mais ser editado.');
    }

    const charter = await prisma.charter.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.contractor !== undefined ? { contractor: data.contractor } : {}),
        ...(data.price !== undefined ? { priceCents: data.price } : {}),
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });

    await audit({
      action: 'CHARTER_UPDATED',
      description: `Fretamento ${id} atualizado.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(charter));
  },
);

/**
 * Atribuicao de veiculo e motorista.
 *
 * Checagem e escrita acontecem na MESMA transacao. Checar fora dela e a corrida
 * classica: dois gestores confirmam ao mesmo tempo, os dois leem "livre", e a
 * mesma van sai agendada para dois contratos no mesmo horario.
 */
router.post(
  '/:id/assign',
  requireRole(...GESTAO),
  requirePermission('canManageRoutes'),
  validate({
    params: uuidParam(),
    body: z.object({ vehicleId: z.string().uuid(), driverId: z.string().uuid() }),
  }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { vehicleId, driverId } = req.valid.body as { vehicleId: string; driverId: string };

    const charter = await prisma.$transaction(async (tx) => {
      const alvo = await tx.charter.findFirst({ where: { id } });
      if (!alvo) throw Errors.notFound('Fretamento');
      if (alvo.status === 'COMPLETED' || alvo.status === 'CANCELED') {
        throw Errors.conflict('Fretamento encerrado não aceita nova atribuição.');
      }

      const [vehicle, driver] = await Promise.all([
        tx.vehicle.findFirst({ where: { id: vehicleId }, select: { id: true } }),
        tx.driver.findFirst({ where: { id: driverId }, select: { id: true } }),
      ]);
      if (!vehicle) throw Errors.notFound('Veículo');
      if (!driver) throw Errors.notFound('Motorista');

      // Sobreposicao de intervalos: comeca antes do outro terminar E termina
      // depois de o outro comecar. Encostar as pontas (fim == inicio) e permitido.
      const conflito = await tx.charter.findFirst({
        where: {
          id: { not: id },
          status: { in: [...STATUS_QUE_OCUPAM_AGENDA] },
          startDate: { lt: alvo.endDate },
          endDate: { gt: alvo.startDate },
          OR: [{ vehicleId }, { driverId }],
        },
        select: { id: true, title: true, vehicleId: true, startDate: true, endDate: true },
      });

      if (conflito) {
        const recurso = conflito.vehicleId === vehicleId ? 'O veículo' : 'O motorista';
        throw Errors.conflict(
          `${recurso} já está escalado no fretamento "${conflito.title}" (${conflito.id}), ` +
            `de ${conflito.startDate.toLocaleDateString('pt-BR')} a ${conflito.endDate.toLocaleDateString('pt-BR')}. ` +
            `Libere aquele contrato ou escolha outro recurso.`,
        );
      }

      return tx.charter.update({ where: { id }, data: { vehicleId, driverId } });
    });

    await audit({
      action: 'CHARTER_ASSIGNED',
      description: `Fretamento ${id} atribuído ao veículo ${vehicleId} e ao motorista ${driverId}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(charter));
  },
);

router.post(
  '/:id/status',
  requireRole(...GESTAO),
  requirePermission('canManageRoutes'),
  validate({ params: uuidParam(), body: z.object({ status: statusField }) }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const { status } = req.valid.body as { status: string };

    const existing = await prisma.charter.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw Errors.notFound('Fretamento');

    const permitidas = TRANSICOES[existing.status] ?? [];
    if (!permitidas.includes(status)) {
      throw Errors.conflict(
        `Fretamento em ${existing.status} não pode ir para ${status}. ` +
          `Transições possíveis: ${permitidas.join(', ') || 'nenhuma (contrato encerrado)'}.`,
      );
    }

    const charter = await prisma.charter.update({ where: { id }, data: { status } });

    await audit({
      action: 'CHARTER_STATUS_CHANGED',
      description: `Fretamento ${id} mudou de ${existing.status} para ${status}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(charter));
  },
);

/**
 * Remocao. Charter nao tem `deletedAt` no schema, entao a protecao contra
 * apagar historico e outra: so sai da base contrato que nunca chegou a rodar.
 */
router.delete(
  '/:id',
  requireRole('OWNER'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.charter.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw Errors.notFound('Fretamento');
    if (existing.status !== 'PENDING') {
      throw Errors.conflict(
        'Só fretamento ainda pendente pode ser excluído. Use o cancelamento para encerrar contrato em andamento.',
      );
    }

    await prisma.charter.delete({ where: { id } });

    await audit({
      action: 'CHARTER_DELETED',
      description: `Fretamento ${id} (pendente) excluído.`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

export default router;
