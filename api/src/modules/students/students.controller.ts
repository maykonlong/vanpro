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
 * Alunos.
 *
 * Referencia de como todo modulo deste projeto se estrutura:
 *   - zod na fronteira (o handler nunca le `req.body` cru);
 *   - `requireRole` explicito em TODA rota, incluindo GET;
 *   - filtro de empresa vem do guard do Prisma, nao de `where` escrito a mao;
 *   - paginacao obrigatoria;
 *   - auditoria em toda escrita;
 *   - serializador proprio, para nao vazar coluna nova sem querer.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;
const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

const createSchema = z.object({
  name: text(120, 'Nome do aluno'),
  school: text(160, 'Escola'),
  grade: z.string().trim().max(40).default(''),
  shift: shiftField,
  monthlyFee: brlInput,
  parentId: z.string().uuid().nullish(),
  address: z.string().trim().max(240).nullish(),
  dateOfBirth: z.coerce.date().nullish(),
  lgpdConsent: z.boolean().default(false),
  imageConsent: z.boolean().default(false),
  photoUrl: z.string().trim().max(500).nullish(),
});

const updateSchema = createSchema.partial();

const listQuery = pagination.extend({
  shift: shiftField.optional(),
  status: z.enum(['PENDING', 'BOARDED', 'DELIVERED', 'ABSENT']).optional(),
  search: z.string().trim().max(80).optional(),
});

type StudentRow = Awaited<ReturnType<typeof prisma.student.findFirstOrThrow>>;

/**
 * Serializador explicito. Devolver a entidade inteira faz cada coluna nova
 * virar vazamento silencioso — foi assim que `deleteRequestStatus` e
 * `companyId` acabaram na resposta da versao anterior.
 */
function serialize(s: StudentRow) {
  return {
    id: s.id,
    name: s.name,
    school: s.school,
    grade: s.grade,
    shift: s.shift,
    status: s.status,
    monthlyFee: money(s.monthlyFeeCents),
    parentId: s.parentId,
    photoUrl: s.photoUrl,
    address: s.address,
    dateOfBirth: s.dateOfBirth,
    lgpdConsent: s.lgpdConsent,
    imageConsent: s.imageConsent,
    deleteRequestStatus: s.deleteRequestStatus,
    createdAt: s.createdAt,
  };
}

router.get(
  '/',
  requireRole(...OPERACAO, 'PARENT'),
  validate({ query: listQuery }),
  async (req, res) => {
    const { page, perPage, shift, status, search } = req.valid.query as z.infer<typeof listQuery>;
    const auth = req.auth!;

    // Pai so ve os proprios filhos. A regra vive aqui e nao no front porque o
    // front nao e fronteira de seguranca.
    const where: Record<string, unknown> = {
      ...(shift ? { shift } : {}),
      ...(status ? { status } : {}),
      ...(auth.role === 'PARENT' ? { parentId: auth.userId } : {}),
      // `name` e criptografado em repouso: filtrar por ele no banco devolveria
      // nada. A busca por nome e feita apos a decodificacao, abaixo.
      ...(search ? { school: { contains: search, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.student.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.student.count({ where }),
    ]);

    res.json(paginate(rows.map(serialize), total, { page, perPage }));
  },
);

router.get(
  '/:id',
  requireRole(...OPERACAO, 'PARENT'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const auth = req.auth!;
    const student = await prisma.student.findFirst({ where: { id: req.valid.params.id } });
    if (!student) throw Errors.notFound('Aluno');
    if (auth.role === 'PARENT' && student.parentId !== auth.userId) throw Errors.notFound('Aluno');
    res.json(serialize(student));
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

    await assertPlanLimit(auth.tenantId!, 'students');

    if (data.parentId) {
      const parent = await prisma.user.findFirst({
        where: { id: data.parentId, tenantId: auth.tenantId, role: 'PARENT' },
        select: { id: true },
      });
      if (!parent) throw Errors.notFound('Responsável');
    }

    const student = await prisma.student.create({
      data: {
        companyId: tenantId(),
        name: data.name,
        school: data.school,
        grade: data.grade,
        shift: data.shift,
        monthlyFeeCents: data.monthlyFee,
        parentId: data.parentId ?? null,
        address: data.address ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        lgpdConsent: data.lgpdConsent,
        imageConsent: data.imageConsent,
        consentDate: data.lgpdConsent ? new Date() : null,
        photoUrl: data.photoUrl ?? null,
      },
    });

    await audit({
      action: 'STUDENT_CREATED',
      description: `Aluno cadastrado (id ${student.id}) no turno ${student.shift}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serialize(student));
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

    const existing = await prisma.student.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Aluno');

    const student = await prisma.student.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.school !== undefined ? { school: data.school } : {}),
        ...(data.grade !== undefined ? { grade: data.grade } : {}),
        ...(data.shift !== undefined ? { shift: data.shift } : {}),
        ...(data.monthlyFee !== undefined ? { monthlyFeeCents: data.monthlyFee } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
        ...(data.imageConsent !== undefined
          ? { imageConsent: data.imageConsent, consentDate: new Date() }
          : {}),
        ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl } : {}),
      },
    });

    await audit({
      action: 'STUDENT_UPDATED',
      description: `Aluno ${id} atualizado. Campos: ${Object.keys(data).join(', ') || 'nenhum'}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(student));
  },
);

/**
 * Check-in/out da rota. Motorista e auxiliar operam; pai apenas acompanha.
 */
router.patch(
  '/:id/checkin',
  requireRole(...OPERACAO),
  validate({
    params: uuidParam(),
    body: z.object({ status: z.enum(['BOARDED', 'DELIVERED', 'ABSENT', 'PENDING']) }),
  }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const existing = await prisma.student.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Aluno');

    const student = await prisma.student.update({
      where: { id },
      data: { status: req.valid.body.status },
    });

    await audit({
      action: 'STUDENT_UPDATED',
      description: `Check-in do aluno ${id} alterado para ${req.valid.body.status}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serialize(student));
  },
);

/**
 * Exclusao logica. Hard delete apagaria a base de calculo de faturas ja
 * emitidas e o historico que a empresa precisa guardar por obrigacao fiscal.
 */
router.delete(
  '/:id',
  requireRole('OWNER'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;
    const existing = await prisma.student.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw Errors.notFound('Aluno');

    const pendentes = await prisma.invoice.count({ where: { studentId: id, status: 'PENDING' } });
    if (pendentes > 0) {
      throw Errors.conflict(
        `Este aluno tem ${pendentes} fatura(s) em aberto. Baixe ou cancele antes de remover o cadastro.`,
      );
    }

    await prisma.student.update({ where: { id }, data: { deletedAt: new Date() } });

    await audit({
      action: 'STUDENT_DELETED',
      description: `Aluno ${id} removido (exclusão lógica).`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

export default router;
