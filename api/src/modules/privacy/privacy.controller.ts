import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit, verifyChain } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { money } from '../../lib/money';
import { runUnscoped } from '../../lib/request-context';
import { validate, pagination, paginate, skipTake, uuidParam } from '../../http/validate';
import { requireRole, type AuthState } from '../../http/middlewares/authenticate';

/**
 * LGPD — os seis direitos do titular (Art. 18) com endereco proprio:
 *
 *   confirmacao e acesso  -> GET  /my-data, GET /consents
 *   portabilidade         -> GET  /export
 *   correcao de consento  -> POST /consents
 *   eliminacao            -> POST /forget-me  +  aprovacao pelo controlador
 *   informacao de uso     -> GET  /audit-trail (o que foi feito, por quem)
 *   revisao/oposicao      -> POST /consents com `lgpdConsent:false`
 *
 * Direito sem rota e politica de privacidade, nao software: por isso cada um
 * deles e um endpoint auditado, e nao um e-mail para o suporte.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;

const MARCADOR_ANONIMO = '[DADO ANONIMIZADO - LGPD ART. 18 VI]';
const BASE_LEGAL_EXPORT =
  'LGPD Lei 13.709/2018, Art. 18, V (portabilidade) e Art. 9 (transparência).';

/** Confere que o aluno pertence ao solicitante quando ele e PARENT. */
async function alunoDoSolicitante(studentId: string, auth: AuthState | undefined) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: { id: true, name: true, parentId: true },
  });
  // 404 e nao 403: dizer "existe, mas nao e seu" confirma a existencia do
  // cadastro de uma crianca para quem so tinha um palpite de id.
  if (!student) throw Errors.notFound('Aluno');
  if (auth?.role === 'PARENT' && student.parentId !== auth.userId) throw Errors.notFound('Aluno');
  return student;
}

// ---------------------------------------------------------------------------
// Portabilidade
// ---------------------------------------------------------------------------

/**
 * Exportacao paginada de proposito.
 *
 * Portabilidade pede o conjunto completo, mas uma empresa com milhares de
 * alunos geraria um JSON que derruba o processo ao ser montado em memoria. O
 * manifesto informa `totalPages`, entao o titular busca as partes e tem o todo
 * sem que a rota vire um DoS que o proprio cliente dispara.
 */
router.get(
  '/export',
  requireRole('OWNER', 'PARENT'),
  validate({ query: pagination }),
  async (req, res) => {
    const { page, perPage } = req.valid.query as z.infer<typeof pagination>;
    const auth = req.auth!;

    const where = auth.role === 'PARENT' ? { parentId: auth.userId } : {};

    const [alunos, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...skipTake({ page, perPage }),
        select: {
          id: true,
          name: true,
          school: true,
          grade: true,
          shift: true,
          status: true,
          monthlyFeeCents: true,
          address: true,
          dateOfBirth: true,
          photoUrl: true,
          lgpdConsent: true,
          imageConsent: true,
          consentDate: true,
          deleteRequestStatus: true,
          createdAt: true,
          invoices: {
            select: { id: true, amountCents: true, status: true, dueDate: true, createdAt: true },
          },
        },
      }),
      prisma.student.count({ where }),
    ]);

    const solicitante = await runUnscoped('lgpd-export-requester', () =>
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, role: true },
      }),
    );

    const payload = {
      manifesto: {
        geradoEm: new Date().toISOString(),
        solicitante,
        escopo: auth.role === 'PARENT' ? 'DEPENDENTES_DO_RESPONSAVEL' : 'EMPRESA',
        baseLegal: BASE_LEGAL_EXPORT,
        formato: 'application/json; estruturado e interoperável',
        parte: page,
        totalPartes: Math.max(1, Math.ceil(total / perPage)),
        totalRegistros: total,
      },
      alunos: alunos.map((a) => ({
        ...a,
        mensalidade: money(a.monthlyFeeCents),
        faturas: a.invoices.map((i) => ({
          id: i.id,
          valor: money(i.amountCents),
          status: i.status,
          vencimento: i.dueDate,
          criadaEm: i.createdAt,
        })),
        monthlyFeeCents: undefined,
        invoices: undefined,
      })),
    };

    await audit({
      action: 'LGPD_DATA_EXPORT',
      description: `Exportação de dados (parte ${page}) solicitada por ${auth.role}; ${alunos.length} registro(s) de ${total}.`,
      ipAddress: req.ip ?? null,
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="vanpro-dados-${new Date().toISOString().slice(0, 10)}-parte${page}.json"`,
    );
    res.send(JSON.stringify(payload, null, 2));
  },
);

// ---------------------------------------------------------------------------
// Consentimento
// ---------------------------------------------------------------------------

const consentSchema = z.object({
  studentId: z.string().uuid(),
  lgpdConsent: z.boolean().optional(),
  imageConsent: z.boolean().optional(),
});

router.get(
  '/consents',
  requireRole(...GESTAO, 'PARENT'),
  validate({ query: pagination }),
  async (req, res) => {
    const { page, perPage } = req.valid.query as z.infer<typeof pagination>;
    const auth = req.auth!;

    const where = auth.role === 'PARENT' ? { parentId: auth.userId } : {};

    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake({ page, perPage }),
        select: {
          id: true,
          name: true,
          lgpdConsent: true,
          imageConsent: true,
          consentDate: true,
          deleteRequestStatus: true,
        },
      }),
      prisma.student.count({ where }),
    ]);

    res.json(paginate(rows, total, { page, perPage }));
  },
);

router.post(
  '/consents',
  requireRole(...GESTAO, 'PARENT'),
  validate({ body: consentSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof consentSchema>;
    if (data.lgpdConsent === undefined && data.imageConsent === undefined) {
      throw Errors.validation([{ campo: 'body', erro: 'Informe ao menos um consentimento.' }]);
    }

    await alunoDoSolicitante(data.studentId, req.auth);

    const student = await prisma.student.update({
      where: { id: data.studentId },
      data: {
        ...(data.lgpdConsent !== undefined ? { lgpdConsent: data.lgpdConsent } : {}),
        ...(data.imageConsent !== undefined ? { imageConsent: data.imageConsent } : {}),
        // A data marca a ULTIMA manifestacao, inclusive a revogacao: e ela que
        // prova quando o tratamento passou a ser (ou deixou de ser) autorizado.
        consentDate: new Date(),
      },
      select: {
        id: true,
        lgpdConsent: true,
        imageConsent: true,
        consentDate: true,
      },
    });

    await audit({
      action: 'LGPD_CONSENT_UPDATE',
      description: `Consentimento do aluno ${student.id} atualizado (lgpd=${student.lgpdConsent}, imagem=${student.imageConsent}) por ${req.auth!.role}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(student);
  },
);

// ---------------------------------------------------------------------------
// Eliminacao
// ---------------------------------------------------------------------------

router.post(
  '/forget-me',
  requireRole(...GESTAO, 'PARENT'),
  validate({ body: z.object({ studentId: z.string().uuid() }) }),
  async (req, res) => {
    const studentId = req.valid.body.studentId as string;
    await alunoDoSolicitante(studentId, req.auth);

    // Pedido nao apaga: entra na fila do controlador. O Art. 16 preserva o dado
    // necessario a obrigacao legal, e so quem conhece essas obrigacoes (o OWNER)
    // pode decidir. Apagar direto seria descumprir a guarda fiscal.
    const student = await prisma.student.update({
      where: { id: studentId },
      data: { deleteRequestStatus: 'PENDING_APPROVAL' },
      select: { id: true, deleteRequestStatus: true },
    });

    await audit({
      action: 'LGPD_FORGET_REQUEST',
      description: `Pedido de eliminação registrado para o aluno ${studentId} por ${req.auth!.role}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(202).json({
      student,
      message:
        'Pedido registrado. A empresa tem de avaliar as obrigações legais de guarda antes de executar a eliminação.',
    });
  },
);

router.get(
  '/deletion-requests',
  requireRole('OWNER'),
  validate({ query: pagination }),
  async (req, res) => {
    const { page, perPage } = req.valid.query as z.infer<typeof pagination>;
    const where = { deleteRequestStatus: 'PENDING_APPROVAL' };

    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        ...skipTake({ page, perPage }),
        select: { id: true, name: true, school: true, parentId: true, updatedAt: true },
      }),
      prisma.student.count({ where }),
    ]);

    res.json(paginate(rows, total, { page, perPage }));
  },
);

/**
 * Anonimizacao real: o registro continua existindo para nao romper o historico
 * financeiro, mas nada nele identifica a crianca. Apagar a linha derrubaria as
 * faturas emitidas e a propria trilha que prova a eliminacao.
 */
router.post(
  '/deletion-requests/:studentId/approve',
  requireRole('OWNER'),
  validate({ params: uuidParam('studentId') }),
  async (req, res) => {
    const studentId = req.valid.params.studentId as string;

    const student = await prisma.student.findFirst({
      where: { id: studentId },
      select: { id: true, deleteRequestStatus: true },
    });
    if (!student) throw Errors.notFound('Aluno');
    if (student.deleteRequestStatus !== 'PENDING_APPROVAL') {
      throw Errors.conflict('Não há pedido de eliminação pendente para este aluno.');
    }

    const pendentes = await prisma.invoice.count({ where: { studentId, status: 'PENDING' } });
    if (pendentes > 0) {
      throw Errors.conflict(
        `Este aluno tem ${pendentes} fatura(s) em aberto. A obrigação fiscal de guarda prevalece sobre o pedido de eliminação ` +
          `(LGPD Art. 16, I): baixe ou cancele as faturas e refaça a aprovação.`,
      );
    }

    const anonimizado = await prisma.student.update({
      where: { id: studentId },
      data: {
        name: MARCADOR_ANONIMO,
        address: MARCADOR_ANONIMO,
        photoUrl: MARCADOR_ANONIMO,
        dateOfBirth: null,
        latitude: null,
        longitude: null,
        parentId: null,
        deleteRequestStatus: 'DELETED',
        deletedAt: new Date(),
      },
      select: { id: true, deleteRequestStatus: true, deletedAt: true },
    });

    await audit({
      action: 'LGPD_FORGET_EXECUTED',
      description: `Eliminação aprovada e executada para o aluno ${studentId}: dados pessoais anonimizados, histórico financeiro preservado.`,
      ipAddress: req.ip ?? null,
    });

    res.json(anonimizado);
  },
);

// ---------------------------------------------------------------------------
// Confirmacao de tratamento e trilha
// ---------------------------------------------------------------------------

router.get('/my-data', requireRole('OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT'), async (req, res) => {
  const auth = req.auth!;

  const user = await runUnscoped('lgpd-my-data', () =>
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        passwordUpdatedAt: true,
        isTwoFactorEnabled: true,
        contracts: {
          select: {
            id: true,
            companyId: true,
            role: true,
            status: true,
            contractType: true,
            joinedAt: true,
            leftAt: true,
          },
        },
        sessions: {
          where: { revokedAt: null },
          select: { id: true, ipAddress: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    }),
  );
  if (!user) throw Errors.notFound('Usuário');

  res.json({
    manifesto: {
      geradoEm: new Date().toISOString(),
      baseLegal: 'LGPD Lei 13.709/2018, Art. 18, I e II (confirmação e acesso).',
      observacao:
        'Senha e segredos de 2 fatores não aparecem aqui: são guardados apenas como hash/cifra e não podem ser exibidos.',
    },
    usuario: user,
  });
});

router.get(
  '/audit-trail',
  requireRole('OWNER'),
  validate({ query: pagination.extend({ action: z.string().trim().max(60).optional() }) }),
  async (req, res) => {
    const { page, perPage, action } = req.valid.query as z.infer<typeof pagination> & {
      action?: string;
    };
    const auth = req.auth!;
    const where = action ? { action } : {};

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake({ page, perPage }),
        select: {
          id: true,
          action: true,
          description: true,
          userId: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // A cadeia e verificada a cada consulta: uma trilha que ninguem confere e
    // so um log com pretensao. Se ela quebrou, quem le a pagina precisa saber
    // disso antes de usar o conteudo como prova.
    const chainIntegrity = await verifyChain(auth.tenantId);

    res.json({ ...paginate(rows, total, { page, perPage }), chainIntegrity });
  },
);

export default router;
