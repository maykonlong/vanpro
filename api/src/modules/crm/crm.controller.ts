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
  text,
} from '../../http/validate';
import { requireRole } from '../../http/middlewares/authenticate';
import { emitToCompany } from '../../realtime/emitter';
import type { AuthState } from '../../http/middlewares/authenticate';

/**
 * CRM interno: notas do aluno, alertas de incidente e chat da equipe.
 *
 * Segue o molde de `students.controller.ts`. As tres areas moram no mesmo
 * modulo porque compartilham a mesma fronteira de leitura: e o material que a
 * equipe troca sobre a operacao, e o responsavel so enxerga a fatia que foi
 * deliberadamente marcada como visivel para ele.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;
const OPERACAO = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT'] as const;

// ---------------------------------------------------------------------------
// Notas do aluno
// ---------------------------------------------------------------------------

type NoteRow = Awaited<ReturnType<typeof prisma.note.findFirstOrThrow>>;

function serializeNote(n: NoteRow) {
  return {
    id: n.id,
    studentId: n.studentId,
    authorId: n.authorId,
    content: n.content,
    isSecret: n.isSecret,
    createdAt: n.createdAt,
  };
}

/**
 * Confere que o aluno existe e que quem pergunta pode falar sobre ele.
 *
 * Responsavel que pede aluno de outra familia recebe 404, nao 403: o 403
 * confirmaria que aquele id existe nesta empresa, e enumerar ids ate achar um
 * "proibido" e como se descobre a lista de alunos de fora.
 */
async function assertStudentVisible(studentId: string, auth: AuthState) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: { id: true, parentId: true },
  });
  if (!student) throw Errors.notFound('Aluno');
  if (auth.role === 'PARENT' && student.parentId !== auth.userId) throw Errors.notFound('Aluno');
  return student;
}

router.get(
  '/students/:studentId/notes',
  requireRole(...OPERACAO, 'PARENT'),
  validate({ params: uuidParam('studentId'), query: pagination }),
  async (req, res) => {
    const { page, perPage } = req.valid.query as z.infer<typeof pagination>;
    const studentId = req.valid.params.studentId as string;
    const auth = req.auth!;

    await assertStudentVisible(studentId, auth);

    // Nota sigilosa e conversa da equipe sobre a familia. O filtro vive no
    // `where` e nao num `.filter()` depois: nota que nunca sai do banco nao
    // vaza por paginacao mal contada nem por serializador esquecido.
    const where = {
      studentId,
      ...(auth.role === 'PARENT' ? { isSecret: false } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.note.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.note.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeNote), total, { page, perPage }));
  },
);

router.post(
  '/students/:studentId/notes',
  requireRole(...OPERACAO),
  validate({
    params: uuidParam('studentId'),
    body: z.object({
      content: text(2000, 'Conteúdo da nota'),
      isSecret: z.boolean().default(true),
    }),
  }),
  async (req, res) => {
    const studentId = req.valid.params.studentId as string;
    const body = req.valid.body as { content: string; isSecret: boolean };
    const auth = req.auth!;

    await assertStudentVisible(studentId, auth);

    const note = await prisma.note.create({
      data: {
        companyId: tenantId(),
        studentId,
        // Autor vem da sessao. Aceitar `authorId` do corpo deixaria qualquer um
        // assinar uma nota com o nome de outro funcionario.
        authorId: auth.userId,
        content: body.content,
        isSecret: body.isSecret,
      },
    });

    await audit({
      action: 'NOTE_CREATED',
      description: `Nota ${note.id} criada para o aluno ${studentId} (sigilosa: ${note.isSecret}).`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serializeNote(note));
  },
);

router.delete(
  '/notes/:id',
  requireRole(...GESTAO),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.note.findFirst({
      where: { id },
      select: { id: true, studentId: true },
    });
    if (!existing) throw Errors.notFound('Nota');

    await prisma.note.delete({ where: { id } });

    await audit({
      action: 'NOTE_DELETED',
      description: `Nota ${id} do aluno ${existing.studentId} removida.`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// Incidentes
// ---------------------------------------------------------------------------

const severityField = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

type IncidentRow = Awaited<ReturnType<typeof prisma.incidentAlert.findFirstOrThrow>>;

function serializeIncident(i: IncidentRow) {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    createdById: i.createdById,
    createdAt: i.createdAt,
  };
}

const incidentListQuery = pagination.extend({ severity: severityField.optional() });

router.get(
  '/incidents',
  requireRole(...OPERACAO),
  validate({ query: incidentListQuery }),
  async (req, res) => {
    const { page, perPage, severity } = req.valid.query as z.infer<typeof incidentListQuery>;
    const where = severity ? { severity } : {};

    const [rows, total] = await Promise.all([
      prisma.incidentAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake({ page, perPage }),
      }),
      prisma.incidentAlert.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeIncident), total, { page, perPage }));
  },
);

router.post(
  '/incidents/broadcast',
  requireRole(...GESTAO),
  validate({
    body: z.object({
      title: text(120, 'Título do incidente'),
      description: text(2000, 'Descrição do incidente'),
      severity: severityField.default('MEDIUM'),
    }),
  }),
  async (req, res) => {
    const body = req.valid.body as { title: string; description: string; severity: string };
    const auth = req.auth!;

    const incident = await prisma.incidentAlert.create({
      data: {
        companyId: tenantId(),
        title: body.title,
        description: body.description,
        severity: body.severity,
        createdById: auth.userId,
      },
    });

    const payload = serializeIncident(incident);

    // Sala da empresa, nunca broadcast global: alerta de incidente cita rota,
    // veiculo e horario, e isso e o mapa da operacao entregue ao vizinho.
    if (auth.tenantId) emitToCompany(auth.tenantId, 'incident:new', payload);

    await audit({
      action: 'INCIDENT_BROADCAST',
      description: `Incidente ${incident.id} (${incident.severity}) disparado para a equipe.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(payload);
  },
);

// ---------------------------------------------------------------------------
// Chat da equipe
// ---------------------------------------------------------------------------

type TeamMessageRow = Awaited<ReturnType<typeof prisma.teamMessage.findFirstOrThrow>>;

function serializeMessage(m: TeamMessageRow) {
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName,
    content: m.content,
    createdAt: m.createdAt,
  };
}

router.get(
  '/chat/messages',
  requireRole(...OPERACAO),
  validate({ query: pagination }),
  async (req, res) => {
    const { page, perPage } = req.valid.query as z.infer<typeof pagination>;

    // Pagina pelas mais recentes (a pagina 1 e a que o cliente abre), mas
    // devolve em ordem cronologica para a conversa ser lida de cima para baixo.
    const [rows, total] = await Promise.all([
      prisma.teamMessage.findMany({ orderBy: { createdAt: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.teamMessage.count(),
    ]);

    res.json(paginate(rows.reverse().map(serializeMessage), total, { page, perPage }));
  },
);

router.post(
  '/chat/messages',
  requireRole(...OPERACAO),
  validate({ body: z.object({ content: text(2000, 'Mensagem') }) }),
  async (req, res) => {
    const { content } = req.valid.body as { content: string };
    const auth = req.auth!;

    // `senderName` sai do banco. Aceitar o nome vindo do corpo permitiria
    // publicar no chat da equipe assinando como o dono da empresa.
    const sender = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });
    if (!sender) throw Errors.unauthorized('Sessão inválida.');

    const message = await prisma.teamMessage.create({
      data: { companyId: tenantId(), senderId: auth.userId, senderName: sender.name, content },
    });

    const payload = serializeMessage(message);
    if (auth.tenantId) emitToCompany(auth.tenantId, 'chat:message', payload);

    await audit({
      action: 'TEAM_MESSAGE_SENT',
      description: `Mensagem ${message.id} publicada no chat da equipe.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(payload);
  },
);

export default router;
