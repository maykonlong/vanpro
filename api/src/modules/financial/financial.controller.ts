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
  documentField,
  text,
} from '../../http/validate';
import { requireRole, requirePermission } from '../../http/middlewares/authenticate';
import { AsaasService } from './asaas.service';

/**
 * Financeiro: DRE, mensalidades, despesas e faturas.
 *
 * A versao anterior deste modulo somava `prisma.student.aggregate()` SEM filtro
 * de empresa — o DRE de uma van mostrava o faturamento de todas as outras.
 * Aqui nenhuma consulta escreve `companyId` a mao: quem injeta e o guard do
 * Prisma, a partir do tenant do contexto. Consulta sem tenant nao roda.
 */

const router = Router();

const GESTAO = ['OWNER', 'MANAGER'] as const;

const CATEGORIAS = ['FUEL', 'MAINTENANCE', 'PAYROLL', 'TAXES', 'OTHER'] as const;
const categoriaField = z.enum(CATEGORIAS);

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

const periodQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function resolvePeriodo(from?: Date, to?: Date) {
  const agora = new Date();
  const inicio = from ?? new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));

  // `to=2026-01-31` chega como meia-noite; sem esticar ate o fim do dia o
  // relatorio perderia o ultimo dia inteiro do periodo pedido. Se o cliente
  // mandou hora explicita, ela e respeitada.
  let fim = to ?? agora;
  if (to && to.getUTCHours() === 0 && to.getUTCMinutes() === 0 && to.getUTCSeconds() === 0) {
    fim = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  if (inicio > fim) {
    throw Errors.validation([
      { campo: 'query.from', erro: 'O início do período é posterior ao fim.' },
    ]);
  }
  return { inicio, fim };
}

function percentual(lucro: number, receita: number): number {
  if (receita === 0) return 0;
  return Math.round((lucro / receita) * 10000) / 100;
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

/**
 * Regime de caixa: entrada conta quando foi PAGA (`paidAt`), nao quando foi
 * emitida. Somar por `dueDate` inflaria o mes com mensalidade em aberto e o
 * lucro exibido nunca bateria com o extrato.
 */
router.get(
  '/dre',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: periodQuery }),
  async (req, res) => {
    const { from, to } = req.valid.query as z.infer<typeof periodQuery>;
    const { inicio, fim } = resolvePeriodo(from, to);

    const [mensalidades, fretamentos, porCategoria] = await Promise.all([
      prisma.financialTransaction.aggregate({
        _sum: { amountCents: true },
        where: { paid: true, paidAt: { gte: inicio, lte: fim } },
      }),
      prisma.charter.aggregate({
        _sum: { priceCents: true },
        where: { status: 'COMPLETED', endDate: { gte: inicio, lte: fim } },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        _sum: { amountCents: true },
        where: { date: { gte: inicio, lte: fim } },
      }),
    ]);

    const receitaMensalidades = mensalidades._sum.amountCents ?? 0;
    const receitaFretamentos = fretamentos._sum.priceCents ?? 0;
    const receitaTotal = receitaMensalidades + receitaFretamentos;

    // Todas as categorias aparecem, inclusive as zeradas: o front mostra a
    // linha "R$ 0,00" em vez de omitir a categoria e sugerir que ela nao existe.
    const mapa = new Map<string, number>(CATEGORIAS.map((c) => [c as string, 0]));
    for (const linha of porCategoria) {
      mapa.set(linha.category, linha._sum.amountCents ?? 0);
    }

    const despesaTotal = [...mapa.values()].reduce((acc, v) => acc + v, 0);
    const lucroLiquido = receitaTotal - despesaTotal;

    res.json({
      receitas: {
        mensalidades: money(receitaMensalidades),
        fretamentos: money(receitaFretamentos),
        total: money(receitaTotal),
      },
      despesasPorCategoria: [...mapa.entries()].map(([categoria, cents]) => ({
        categoria,
        valor: money(cents),
      })),
      despesaTotal: money(despesaTotal),
      lucroLiquido: money(lucroLiquido),
      margemPercentual: percentual(lucroLiquido, receitaTotal),
      periodo: { from: inicio, to: fim },
    });
  },
);

/**
 * ROI por veiculo: quanto cada van custou (despesas atreladas a ela) contra o
 * que ela trouxe em fretamento. Mensalidade nao entra: o aluno nao e vinculado
 * a veiculo no schema, e ratear por chute produziria um numero que parece exato.
 */
router.get(
  '/dre/by-vehicle',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: periodQuery }),
  async (req, res) => {
    const { from, to } = req.valid.query as z.infer<typeof periodQuery>;
    const { inicio, fim } = resolvePeriodo(from, to);

    const [veiculos, despesas, receitas] = await Promise.all([
      prisma.vehicle.findMany({ select: { id: true, plate: true, model: true } }),
      prisma.expense.groupBy({
        by: ['vehicleId'],
        _sum: { amountCents: true },
        where: { vehicleId: { not: null }, date: { gte: inicio, lte: fim } },
      }),
      prisma.charter.groupBy({
        by: ['vehicleId'],
        _sum: { priceCents: true },
        where: { vehicleId: { not: null }, status: 'COMPLETED', endDate: { gte: inicio, lte: fim } },
      }),
    ]);

    const despesaPorVeiculo = new Map<string, number>();
    for (const d of despesas) {
      if (d.vehicleId) despesaPorVeiculo.set(d.vehicleId, d._sum.amountCents ?? 0);
    }
    const receitaPorVeiculo = new Map<string, number>();
    for (const r of receitas) {
      if (r.vehicleId) receitaPorVeiculo.set(r.vehicleId, r._sum.priceCents ?? 0);
    }

    const itens = veiculos.map((v) => {
      const receita = receitaPorVeiculo.get(v.id) ?? 0;
      const despesa = despesaPorVeiculo.get(v.id) ?? 0;
      const resultado = receita - despesa;
      return {
        vehicleId: v.id,
        plate: v.plate,
        model: v.model,
        receita: money(receita),
        despesa: money(despesa),
        resultado: money(resultado),
        margemPercentual: percentual(resultado, receita),
      };
    });

    res.json({ itens, periodo: { from: inicio, to: fim } });
  },
);

// ---------------------------------------------------------------------------
// Mensalidades (FinancialTransaction)
// ---------------------------------------------------------------------------

type TransactionRow = Awaited<ReturnType<typeof prisma.financialTransaction.findFirstOrThrow>>;

function serializeTransaction(t: TransactionRow) {
  return {
    id: t.id,
    studentId: t.studentId,
    amount: money(t.amountCents),
    paid: t.paid,
    paidAt: t.paidAt,
    dueDate: t.dueDate,
    externalId: t.externalId,
    createdAt: t.createdAt,
  };
}

const transactionListQuery = pagination.extend({
  paid: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  studentId: z.string().uuid().optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});

router.get(
  '/transactions',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: transactionListQuery }),
  async (req, res) => {
    const { page, perPage, paid, studentId, dueFrom, dueTo } = req.valid.query as z.infer<
      typeof transactionListQuery
    >;

    const where = {
      ...(paid !== undefined ? { paid } : {}),
      ...(studentId ? { studentId } : {}),
      ...(dueFrom || dueTo
        ? { dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.financialTransaction.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        ...skipTake({ page, perPage }),
      }),
      prisma.financialTransaction.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeTransaction), total, { page, perPage }));
  },
);

const createTransactionSchema = z.object({
  studentId: z.string().uuid(),
  amount: brlInput,
  dueDate: z.coerce.date(),
});

router.post(
  '/transactions',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ body: createTransactionSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createTransactionSchema>;

    // Aluno de outra empresa nao aparece nesta consulta — o guard ja filtrou.
    const student = await prisma.student.findFirst({
      where: { id: data.studentId },
      select: { id: true },
    });
    if (!student) throw Errors.notFound('Aluno');

    const transaction = await prisma.financialTransaction.create({
      data: {
        companyId: tenantId(),
        studentId: student.id,
        amountCents: data.amount,
        dueDate: data.dueDate,
        paid: false,
      },
    });

    await audit({
      action: 'INVOICE_CREATED',
      description: `Mensalidade ${transaction.id} lançada para o aluno ${student.id}, vencimento ${data.dueDate.toISOString().slice(0, 10)}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serializeTransaction(transaction));
  },
);

/**
 * Baixa manual (dinheiro, transferencia fora do gateway).
 * Recebimento e o evento mais sensivel do modulo: sem trilha nao ha como provar
 * quem deu baixa em qual mensalidade.
 */
router.post(
  '/transactions/:id/settle',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.financialTransaction.findFirst({
      where: { id },
      select: { id: true, paid: true },
    });
    if (!existing) throw Errors.notFound('Mensalidade');
    if (existing.paid) throw Errors.conflict('Esta mensalidade já consta como paga.');

    const transaction = await prisma.financialTransaction.update({
      where: { id },
      data: { paid: true, paidAt: new Date() },
    });

    await audit({
      action: 'INVOICE_PAID',
      description: `Baixa manual da mensalidade ${id} no valor de ${money(transaction.amountCents).formatted}.`,
      ipAddress: req.ip ?? null,
    });

    res.json(serializeTransaction(transaction));
  },
);

// ---------------------------------------------------------------------------
// Despesas
// ---------------------------------------------------------------------------

type ExpenseRow = Awaited<ReturnType<typeof prisma.expense.findFirstOrThrow>>;

function serializeExpense(e: ExpenseRow) {
  return {
    id: e.id,
    description: e.description,
    amount: money(e.amountCents),
    category: e.category,
    date: e.date,
    vehicleId: e.vehicleId,
    employeeId: e.employeeId,
    receiptUrl: e.receiptUrl,
    createdAt: e.createdAt,
  };
}

const expenseListQuery = pagination.extend({
  category: categoriaField.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  vehicleId: z.string().uuid().optional(),
});

router.get(
  '/expenses',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: expenseListQuery }),
  async (req, res) => {
    const { page, perPage, category, from, to, vehicleId } = req.valid.query as z.infer<
      typeof expenseListQuery
    >;

    const where = {
      ...(category ? { category } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.expense.findMany({ where, orderBy: { date: 'desc' }, ...skipTake({ page, perPage }) }),
      prisma.expense.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeExpense), total, { page, perPage }));
  },
);

const createExpenseSchema = z.object({
  description: text(200, 'Descrição da despesa'),
  amount: brlInput,
  category: categoriaField,
  date: z.coerce.date().optional(),
  vehicleId: z.string().uuid().nullish(),
  employeeId: z.string().uuid().nullish(),
  receiptUrl: z.string().trim().max(500).nullish(),
});

router.post(
  '/expenses',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ body: createExpenseSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createExpenseSchema>;

    if (data.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: data.vehicleId },
        select: { id: true },
      });
      if (!vehicle) throw Errors.notFound('Veículo');
    }

    if (data.employeeId) {
      // `User` nao e modelo escopado por tenant; o vinculo (`UserCompany`) e.
      // Conferir pelo vinculo e o que impede atrelar despesa a alguem de outra
      // empresa so por saber o uuid.
      const vinculo = await prisma.userCompany.findFirst({
        where: { userId: data.employeeId },
        select: { id: true },
      });
      if (!vinculo) throw Errors.notFound('Funcionário');
    }

    const expense = await prisma.expense.create({
      data: {
        companyId: tenantId(),
        description: data.description,
        amountCents: data.amount,
        category: data.category,
        date: data.date ?? new Date(),
        vehicleId: data.vehicleId ?? null,
        employeeId: data.employeeId ?? null,
        receiptUrl: data.receiptUrl ?? null,
      },
    });

    await audit({
      action: 'EXPENSE_CREATED',
      description: `Despesa ${expense.id} (${expense.category}) de ${money(expense.amountCents).formatted} registrada.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serializeExpense(expense));
  },
);

/**
 * Exclusao de despesa altera o DRE de um periodo possivelmente ja fechado — por
 * isso e exclusiva do OWNER e sempre auditada com o valor que saiu do relatorio.
 */
router.delete(
  '/expenses/:id',
  requireRole('OWNER'),
  validate({ params: uuidParam() }),
  async (req, res) => {
    const id = req.valid.params.id as string;

    const existing = await prisma.expense.findFirst({
      where: { id },
      select: { id: true, amountCents: true, category: true },
    });
    if (!existing) throw Errors.notFound('Despesa');

    await prisma.expense.delete({ where: { id } });

    await audit({
      action: 'EXPENSE_DELETED',
      description: `Despesa ${id} (${existing.category}) de ${money(existing.amountCents).formatted} excluída.`,
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// Faturas (cobranca no gateway)
// ---------------------------------------------------------------------------

type InvoiceRow = Awaited<ReturnType<typeof prisma.invoice.findFirstOrThrow>>;

function serializeInvoice(i: InvoiceRow) {
  return {
    id: i.id,
    studentId: i.studentId,
    amount: money(i.amountCents),
    status: i.status,
    dueDate: i.dueDate,
    gatewayId: i.gatewayId,
    paymentUrl: i.paymentUrl,
    createdAt: i.createdAt,
  };
}

const invoiceListQuery = pagination.extend({
  status: z.enum(['PENDING', 'RECEIVED', 'OVERDUE', 'CANCELED']).optional(),
  studentId: z.string().uuid().optional(),
});

router.get(
  '/invoices',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: invoiceListQuery }),
  async (req, res) => {
    const { page, perPage, status, studentId } = req.valid.query as z.infer<typeof invoiceListQuery>;

    const where = {
      ...(status ? { status } : {}),
      ...(studentId ? { studentId } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        ...skipTake({ page, perPage }),
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json(paginate(rows.map(serializeInvoice), total, { page, perPage }));
  },
);

const createInvoiceSchema = z.object({
  studentId: z.string().uuid(),
  amount: brlInput,
  dueDate: z.coerce.date(),
  /** CPF/CNPJ do pagador: o gateway exige, e o schema do aluno nao guarda. */
  payerDocument: documentField,
  payerName: z.string().trim().max(120).optional(),
});

router.post(
  '/invoices',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ body: createInvoiceSchema }),
  async (req, res) => {
    const data = req.valid.body as z.infer<typeof createInvoiceSchema>;

    // Sem credencial do Asaas o servico lanca 503. Nao existe caminho aqui que
    // grave fatura sem cobranca real do outro lado.
    const invoice = await AsaasService.createPixCharge({
      studentId: data.studentId,
      amountCents: data.amount,
      dueDate: data.dueDate,
      payerDocument: data.payerDocument,
      payerName: data.payerName,
    });

    await audit({
      action: 'INVOICE_CREATED',
      description: `Cobrança Pix ${invoice.id} (gateway ${invoice.gatewayId ?? '-'}) de ${money(invoice.amountCents).formatted} gerada para o aluno ${invoice.studentId}.`,
      ipAddress: req.ip ?? null,
    });

    res.status(201).json(serializeInvoice(invoice));
  },
);

export default router;
