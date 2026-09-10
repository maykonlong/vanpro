import { Router } from 'express';
import { tenantId } from '../../lib/tenant';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { validate, pagination, paginate, skipTake, uuidParam } from '../../http/validate';
import { requireRole } from '../../http/middlewares/authenticate';

/**
 * Cartao de ponto.
 *
 * Documento trabalhista: cada batida e um fato, nunca uma correcao silenciosa.
 * Por isso o Punch e append-only e o Timecard so muda de estado — a jornada e
 * reconstruida pela sequencia de batidas, nao por campos de hora editaveis.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;

const punchType = z.enum(['CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT']);
type PunchType = z.infer<typeof punchType>;

const punchSchema = z
  .object({
    type: punchType,
    vehicleId: z.string().uuid('identificador de veículo inválido'),
    km: z.coerce.number().int().min(0).max(9_999_999).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    // Nao ha `driverId` aqui de proposito para o motorista: quem bate o ponto e
    // sempre a sessao autenticada. Aceitar o id do corpo sem ressalva deixaria
    // um motorista bater ponto no lugar de outro.
    driverId: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.km === undefined || v.type === 'CLOCK_IN' || v.type === 'CLOCK_OUT',
    { message: 'Quilometragem só é registrada na entrada e na saída', path: ['km'] },
  );

const listQuery = pagination.extend({
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  driverId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
});

type TimecardRow = Awaited<ReturnType<typeof prisma.timecard.findFirstOrThrow>>;
type PunchRow = Awaited<ReturnType<typeof prisma.punch.findFirstOrThrow>>;

function serializePunch(p: PunchRow) {
  return {
    id: p.id,
    type: p.type,
    km: p.km,
    latitude: p.latitude,
    longitude: p.longitude,
    createdAt: p.createdAt,
  };
}

function serialize(t: TimecardRow & { punches: PunchRow[] }) {
  return {
    id: t.id,
    driverId: t.driverId,
    vehicleId: t.vehicleId,
    status: t.status,
    date: t.date,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    punches: t.punches.map(serializePunch),
  };
}

/** Pausa aberta = mais inicios que fins. Nao depende da ordem de leitura. */
function pausaAberta(punches: PunchRow[]): boolean {
  const inicios = punches.filter((p) => p.type === 'BREAK_START').length;
  const fins = punches.filter((p) => p.type === 'BREAK_END').length;
  return inicios > fins;
}

/**
 * Descobre de quem e a batida.
 *
 * Motorista: sempre o proprio cadastro, achado pelo `userId` da sessao.
 * Gestao: pode informar `driverId` para registro manual (motorista sem celular,
 * esquecimento, ajuste de folha) — e essa batida vai auditada com destaque.
 */
async function resolveDriver(
  role: string,
  userId: string,
  informado: string | undefined,
): Promise<{ driverId: string; manual: boolean }> {
  const gestao = (GESTAO as readonly string[]).includes(role) || role === 'SUPER_ADMIN';

  if (informado) {
    if (!gestao) {
      throw Errors.forbidden('Você só pode registrar o próprio ponto.');
    }
    const alvo = await prisma.driver.findFirst({
      where: { id: informado, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!alvo) throw Errors.notFound('Motorista');
    return { driverId: alvo.id, manual: true };
  }

  const self = await prisma.driver.findFirst({
    where: { userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!self) {
    throw Errors.forbidden(
      'Seu usuário não está vinculado a um cadastro de motorista ativo nesta empresa.',
    );
  }
  return { driverId: self.id, manual: false };
}

router.get(
  '/',
  requireRole('OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'),
  validate({ query: listQuery }),
  async (req, res) => {
    const { page, perPage, status, driverId, vehicleId } = req.valid.query as z.infer<typeof listQuery>;
    const auth = req.auth!;

    // Motorista ve so a propria folha de ponto. Se nem cadastro de motorista ele
    // tem, o resultado e vazio — e nao a folha da empresa inteira.
    let escopoDriver = driverId;
    if (auth.role === 'DRIVER') {
      const self = await prisma.driver.findFirst({
        where: { userId: auth.userId },
        select: { id: true },
      });
      escopoDriver = self?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const where: Record<string, unknown> = {
      ...(status ? { status } : {}),
      ...(escopoDriver ? { driverId: escopoDriver } : {}),
      ...(vehicleId ? { vehicleId } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.timecard.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { punches: { orderBy: { createdAt: 'asc' } } },
        ...skipTake({ page, perPage }),
      }),
      prisma.timecard.count({ where }),
    ]);

    res.json(paginate(rows.map(serialize), total, { page, perPage }));
  },
);

router.get(
  '/:id',
  requireRole('OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const auth = req.auth!;
    const timecard = await prisma.timecard.findFirst({
      where: { id: req.valid.params.id },
      include: { punches: { orderBy: { createdAt: 'asc' } } },
    });
    if (!timecard) throw Errors.notFound('Cartão de ponto');

    if (auth.role === 'DRIVER') {
      const self = await prisma.driver.findFirst({
        where: { userId: auth.userId },
        select: { id: true },
      });
      // 404 e nao 403: dizer "existe, mas nao e seu" ja entrega a folha alheia.
      if (!self || self.id !== timecard.driverId) throw Errors.notFound('Cartão de ponto');
    }

    res.json(serialize(timecard));
  },
);

/**
 * Batida de ponto.
 *
 * Maquina de estados explicita — o cliente nunca informa em que estado acha que
 * esta. Transicao invalida devolve 409 dizendo o estado atual, para o app poder
 * mostrar o botao certo em vez de insistir no errado.
 */
router.post(
  '/punch',
  requireRole('OWNER', 'MANAGER', 'DRIVER'),
  validate({ body: punchSchema }),
  async (req, res) => {
    const body = req.valid.body as z.infer<typeof punchSchema>;
    const auth = req.auth!;
    const type: PunchType = body.type;

    const { driverId, manual } = await resolveDriver(auth.role, auth.userId, body.driverId);

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId },
      select: { id: true, plate: true },
    });
    if (!vehicle) throw Errors.notFound('Veículo');

    const aberto = await prisma.timecard.findFirst({
      where: { driverId, status: 'IN_PROGRESS' },
      include: { punches: { orderBy: { createdAt: 'asc' } } },
    });

    if (type === 'CLOCK_IN') {
      if (aberto) {
        throw Errors.conflict(
          `Já existe um turno em andamento (cartão ${aberto.id}), aberto em ` +
            `${aberto.date.toLocaleString('pt-BR')}. Registre a saída antes de uma nova entrada.`,
        );
      }

      // Transacao: cartao sem a batida de entrada seria uma jornada sem inicio,
      // e batida sem cartao ficaria orfa. Ou os dois, ou nenhum.
      const criado = await prisma.$transaction(async (tx) => {
        const timecard = await tx.timecard.create({
          data: { companyId: tenantId(), driverId, vehicleId: vehicle.id, status: 'IN_PROGRESS' },
        });
        await tx.punch.create({
          data: {
            companyId: tenantId(),
            timecardId: timecard.id,
            type,
            km: body.km ?? null,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
          },
        });
        return tx.timecard.findFirstOrThrow({
          where: { id: timecard.id },
          include: { punches: { orderBy: { createdAt: 'asc' } } },
        });
      });

      await audit({
        action: 'TIMECARD_PUNCH',
        description:
          `${manual ? 'REGISTRO MANUAL: ' : ''}CLOCK_IN do motorista ${driverId} ` +
          `no veículo ${vehicle.plate} (cartão ${criado.id})` +
          `${manual ? `, lancado por ${auth.userId}` : ''}.`,
        ipAddress: req.ip ?? null,
      });

      return res.status(201).json(serialize(criado));
    }

    if (!aberto) {
      throw Errors.conflict(
        'Não há turno em andamento para este motorista. Registre a entrada (CLOCK_IN) primeiro.',
      );
    }

    if (aberto.vehicleId !== vehicle.id) {
      throw Errors.conflict(
        `O turno em andamento está no veículo ${aberto.vehicleId}. ` +
          `Troca de veículo no meio da jornada exige encerrar o turno atual.`,
      );
    }

    const emPausa = pausaAberta(aberto.punches);

    if (type === 'BREAK_START' && emPausa) {
      throw Errors.conflict('Já existe uma pausa em andamento. Registre o retorno antes.');
    }
    if (type === 'BREAK_END' && !emPausa) {
      throw Errors.conflict('Não há pausa em andamento para encerrar.');
    }
    if (type === 'CLOCK_OUT' && emPausa) {
      throw Errors.conflict(
        'Há uma pausa em andamento. Encerre a pausa (BREAK_END) antes de registrar a saída.',
      );
    }

    if (type === 'CLOCK_OUT' && body.km !== undefined) {
      const entrada = aberto.punches.find((p) => p.type === 'CLOCK_IN' && p.km !== null);
      if (entrada?.km != null && body.km < entrada.km) {
        throw Errors.conflict(
          `A quilometragem da saída (${body.km} km) é menor que a da entrada (${entrada.km} km).`,
        );
      }
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.punch.create({
        data: {
          companyId: tenantId(),
          timecardId: aberto.id,
          type,
          km: body.km ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
        },
      });
      await tx.timecard.update({
        where: { id: aberto.id },
        data: { status: type === 'CLOCK_OUT' ? 'COMPLETED' : 'IN_PROGRESS' },
      });
      return tx.timecard.findFirstOrThrow({
        where: { id: aberto.id },
        include: { punches: { orderBy: { createdAt: 'asc' } } },
      });
    });

    await audit({
      action: 'TIMECARD_PUNCH',
      description:
        `${manual ? 'REGISTRO MANUAL: ' : ''}${type} do motorista ${driverId} ` +
        `no cartão ${aberto.id}` +
        `${manual ? `, lancado por ${auth.userId}` : ''}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serialize(atualizado));
  },
);

export default router;
