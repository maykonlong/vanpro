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
// CSV
// ---------------------------------------------------------------------------

function dataISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Valor em reais com virgula decimal, como a planilha brasileira espera.
 *
 * Ponto decimal faz o Excel em pt-BR ler "480.50" como quatrocentos e oitenta
 * mil e quinhentos — e a diferenca so aparece na hora de fechar o mes.
 */
function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Escapa o campo do CSV.
 *
 * Duas coisas diferentes acontecem aqui, e a segunda e de seguranca:
 *
 *   - aspas e separador dentro do texto quebram a coluna; a saida e o padrao
 *     (RFC 4180): envolver em aspas e dobrar as internas;
 *   - campo que comeca com `=`, `+`, `-` ou `@` e interpretado como FORMULA
 *     pelo Excel. Uma despesa descrita como `=HYPERLINK(...)` viraria codigo
 *     executavel na maquina do contador — e a descricao vem de quem digita.
 *     O apostrofo na frente desarma a formula e nao aparece na celula.
 *
 * A EXCECAO importa tanto quanto a regra: valor monetario negativo comeca com
 * `-` e seria "protegido" em `'-320,75`, que a planilha le como TEXTO. A
 * coluna deixaria de somar, e a defesa teria quebrado exatamente o recurso que
 * ela serve. Numero no nosso proprio formato passa direto.
 */
const NUMERO_NOSSO = /^-?\d+,\d{2}$/;

/**
 * Exportado para o teste. A regra de quais entradas sao desarmadas — e quais
 * NAO podem ser — e a parte que precisa de prova; exercita-la pela rota exigiria
 * cadastrar um aluno com nome hostil so para ler uma celula.
 */
export function campoCsv(valor: string): string {
  const perigoso = /^[=+\-@\t\r]/.test(valor) && !NUMERO_NOSSO.test(valor);
  const texto = perigoso ? `'${valor}` : valor;
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;

}

// ---------------------------------------------------------------------------
// Folha apurada pelo ponto
// ---------------------------------------------------------------------------

/**
 * Quanto de diaria o periodo gerou, segundo os cartoes de ponto FECHADOS.
 *
 * Cartao `COMPLETED` e o registro de que o dia foi trabalhado — e cada dia
 * trabalhado gera uma diaria devida ao motorista. Isso e custo do periodo,
 * exista ou nao um lancamento de despesa correspondente.
 *
 * So conta cartao fechado: turno em andamento pode terminar sem virar diaria
 * (motorista que bateu entrada e foi embora), e contar um dia que ainda nao
 * acabou seria antecipar custo que talvez nao exista.
 *
 * A diaria vem do cadastro ATUAL do motorista, e nao de um historico — o schema
 * nao guarda o valor vigente na data. Consequencia honesta: reajustar a diaria
 * muda a folha apurada de meses passados. Enquanto nao houver historico de
 * remuneracao, o numero e uma estimativa do custo, nao um recibo — e por isso
 * ele NAO entra sozinho no lucro.
 */
async function apurarFolha(inicio: Date, fim: Date) {
  const porMotoristaBruto = await prisma.timecard.groupBy({
    by: ['driverId'],
    _count: { _all: true },
    where: { status: 'COMPLETED', date: { gte: inicio, lte: fim } },
  });

  if (porMotoristaBruto.length === 0) {
    return { totalCents: 0, dias: 0, porMotorista: [] as Array<{ driverId: string; nome: string; dias: number; dailyRateCents: number; totalCents: number }> };
  }

  const motoristas = await prisma.driver.findMany({
    where: { id: { in: porMotoristaBruto.map((m) => m.driverId) } },
    select: { id: true, name: true, dailyRateCents: true },
  });
  const cadastro = new Map(motoristas.map((m) => [m.id, m]));

  const porMotorista = porMotoristaBruto
    .map((m) => {
      const dados = cadastro.get(m.driverId);
      // Motorista removido depois do cartao: o dia trabalhado continua tendo
      // acontecido, mas nao ha diaria para multiplicar. Some da lista em vez de
      // virar zero silencioso no meio dos outros.
      if (!dados) return null;
      const dias = m._count._all;
      return {
        driverId: m.driverId,
        nome: dados.name,
        dias,
        dailyRateCents: dados.dailyRateCents,
        totalCents: dias * dados.dailyRateCents,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.totalCents - a.totalCents);

  return {
    totalCents: porMotorista.reduce((acc, m) => acc + m.totalCents, 0),
    dias: porMotorista.reduce((acc, m) => acc + m.dias, 0),
    porMotorista,
  };
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

    const [mensalidades, fretamentos, porCategoria, folhaApurada] = await Promise.all([
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
      apurarFolha(inicio, fim),
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

    /*
     * A folha que o PONTO diz que existe, contra a que foi LANCADA.
     *
     * O DRE e regime de caixa: so conta o que foi pago e registrado. Isso e
     * correto e reconcilia com o extrato — mas produzia um lucro sistematicamente
     * inflado, porque a diaria do motorista so entrava se alguem lembrasse de
     * digitar uma despesa. O trabalho aconteceu, o cartao de ponto esta fechado,
     * e o custo simplesmente nao aparecia.
     *
     * A saida NAO e somar a folha apurada no lucro: isso contaria em dobro
     * assim que o lancamento fosse feito, e trocaria um numero errado por outro.
     * A saida e tornar a omissao impossivel de nao ver — o `lucroLiquido`
     * continua sendo o de caixa, e ao lado dele aparece quanto de diaria o
     * ponto apurou e ainda nao foi lancado.
     */
    const folhaLancada = mapa.get('PAYROLL') ?? 0;
    const folhaNaoLancada = Math.max(0, folhaApurada.totalCents - folhaLancada);

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

      /*
       * Folha: o que o ponto apurou contra o que foi lancado.
       *
       * `naoLancada` acima de zero significa que o lucro acima esta OTIMISTA
       * nesse valor — trabalho feito, diaria devida, despesa nao registrada.
       * A tela usa isto para avisar antes de alguem tomar decisao com o numero.
       */
      folha: {
        apuradaPeloPonto: money(folhaApurada.totalCents),
        lancadaComoDespesa: money(folhaLancada),
        naoLancada: money(folhaNaoLancada),
        diasApurados: folhaApurada.dias,
        porMotorista: folhaApurada.porMotorista.map((m) => ({
          driverId: m.driverId,
          nome: m.nome,
          dias: m.dias,
          diaria: money(m.dailyRateCents),
          total: money(m.totalCents),
        })),
      },
      lucroConsiderandoFolhaApurada: money(lucroLiquido - folhaNaoLancada),

      periodo: { from: inicio, to: fim },
    });
  },
);

/**
 * ROI por veiculo: quanto cada van custou (despesas atreladas a ela) contra o
 * que ela trouxe em fretamento. Mensalidade nao entra: o aluno nao e vinculado
 * a veiculo no schema, e ratear por chute produziria um numero que parece exato.
 */
/**
 * Exportacao do periodo em CSV, para o contador.
 *
 * O pedido mais comum de quem tem contabilidade e o mais simples de atender: o
 * escritorio nao vai abrir a tela do sistema todo mes, e uma tela que so mostra
 * numero obriga alguem a redigitar tudo numa planilha — que e onde o erro entra.
 *
 * Uma linha por LANCAMENTO, e nao o resumo do DRE: o contador precisa do
 * detalhe para classificar, e o resumo ele mesmo faz na planilha dele.
 */
router.get(
  '/export.csv',
  requireRole(...GESTAO),
  requirePermission('canManageFinance'),
  validate({ query: periodQuery }),
  async (req, res) => {
    const { from, to } = req.valid.query as z.infer<typeof periodQuery>;
    const { inicio, fim } = resolvePeriodo(from, to);

    const [mensalidades, fretamentos, despesas] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: { paid: true, paidAt: { gte: inicio, lte: fim } },
        orderBy: { paidAt: 'asc' },
        select: {
          paidAt: true,
          dueDate: true,
          amountCents: true,
          competencia: true,
          student: { select: { name: true } },
        },
      }),
      prisma.charter.findMany({
        where: { status: 'COMPLETED', endDate: { gte: inicio, lte: fim } },
        orderBy: { endDate: 'asc' },
        select: { endDate: true, title: true, priceCents: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: inicio, lte: fim } },
        orderBy: { date: 'asc' },
        select: { date: true, description: true, category: true, amountCents: true },
      }),
    ]);

    const linhas: string[][] = [
      ['data', 'tipo', 'categoria', 'descricao', 'competencia', 'valor'],
    ];

    for (const m of mensalidades) {
      linhas.push([
        dataISO(m.paidAt ?? m.dueDate),
        'RECEITA',
        'MENSALIDADE',
        `Mensalidade de ${m.student.name}`,
        m.competencia ?? '',
        reais(m.amountCents),
      ]);
    }
    for (const c of fretamentos) {
      linhas.push([dataISO(c.endDate), 'RECEITA', 'FRETAMENTO', c.title, '', reais(c.priceCents)]);
    }
    for (const d of despesas) {
      // Despesa com sinal negativo: aberto numa planilha, a coluna soma sozinha
      // e da o resultado do periodo. Com todos positivos, quem abre precisa
      // saber quais linhas subtrair — e alguem sempre erra.
      linhas.push([dataISO(d.date), 'DESPESA', d.category, d.description, '', reais(-d.amountCents)]);
    }

    linhas.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    // O cabecalho volta para o topo depois da ordenacao por data.
    const cabecalho = linhas.findIndex((l) => l[0] === 'data');
    if (cabecalho > 0) linhas.unshift(...linhas.splice(cabecalho, 1));

    await audit({
      action: 'LGPD_DATA_EXPORT',
      description: `Exportação financeira em CSV do período ${dataISO(inicio)} a ${dataISO(fim)} (${linhas.length - 1} lançamentos).`,
      ipAddress: req.ip ?? null,
    });

    const nome = `vanpro-financeiro-${dataISO(inicio)}-a-${dataISO(fim)}.csv`;
    // `text/csv` com BOM: sem ele o Excel em portugues abre "José" como "JosÃ©".
    // O BOM e feio e e o que faz o arquivo abrir certo na maquina do contador.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send('\uFEFF' + linhas.map((l) => l.map(campoCsv).join(';')).join('\r\n'));
  },
);

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
