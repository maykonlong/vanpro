import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import { campoCsv } from '../../src/modules/financial/financial.controller';
import { criarEmpresa, criarUsuario, autenticar, type Empresa } from '../helpers/factory';

/**
 * Financeiro.
 *
 * O DRE aqui e conferido centavo a centavo contra numeros montados a mao. Nao e
 * preciosismo: a versao anterior agregava sem filtro de empresa e o relatorio
 * "fechava" — parecia certo porque ninguem tinha somado do lado de fora. Um
 * teste que so verifica que o endpoint responde 200 teria aprovado aquilo.
 */

const PERIODO = '?from=2026-03-01&to=2026-03-31';

let alfa: Empresa;
let beta: Empresa;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  beta = await criarEmpresa('Empresa Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
});

/**
 * Cenario com valores escolhidos a mao:
 *   receita de mensalidade  = 480,50 + 219,50            = 700,00
 *   receita de fretamento   = 4.500,00                   = 4.500,00
 *   despesa FUEL            = 320,75
 *   despesa MAINTENANCE     = 1.200,00
 * O que fica de FORA tambem e escolhido: mensalidade nao paga, mensalidade paga
 * em outro mes e fretamento ainda pendente.
 */
async function montarCenario(companyId: string, escala = 1) {
  return runUnscoped('fixture', async () => {
    const aluno = await prisma.student.create({
      data: { companyId, name: 'Aluno Pagante', school: 'Escola', shift: 'FULL', monthlyFeeCents: toCents(480.5) },
    });
    const veiculo = await prisma.vehicle.create({
      data: { companyId, plate: 'ABC1D23', model: 'Sprinter', capacity: 20 },
    });

    for (const valor of [480.5, 219.5]) {
      await prisma.financialTransaction.create({
        data: {
          companyId,
          studentId: aluno.id,
          amountCents: toCents(valor * escala),
          paid: true,
          paidAt: new Date(Date.UTC(2026, 2, 10)),
          dueDate: new Date(Date.UTC(2026, 2, 5)),
        },
      });
    }
    // Nao paga: regime de caixa nao reconhece receita que ainda nao entrou.
    await prisma.financialTransaction.create({
      data: {
        companyId,
        studentId: aluno.id,
        amountCents: toCents(1000),
        paid: false,
        dueDate: new Date(Date.UTC(2026, 2, 20)),
      },
    });
    // Paga, mas em fevereiro: nao pertence ao periodo pedido.
    await prisma.financialTransaction.create({
      data: {
        companyId,
        studentId: aluno.id,
        amountCents: toCents(999),
        paid: true,
        paidAt: new Date(Date.UTC(2026, 1, 10)),
        dueDate: new Date(Date.UTC(2026, 1, 5)),
      },
    });

    await prisma.charter.create({
      data: {
        companyId,
        title: 'Excursao Serra',
        contractor: 'Escola Aurora',
        priceCents: toCents(4500 * escala),
        startDate: new Date(Date.UTC(2026, 2, 19)),
        endDate: new Date(Date.UTC(2026, 2, 20)),
        status: 'COMPLETED',
        vehicleId: veiculo.id,
      },
    });
    // Fretamento ainda em aberto nao vira receita.
    await prisma.charter.create({
      data: {
        companyId,
        title: 'Excursao Futura',
        contractor: 'Escola Aurora',
        priceCents: toCents(8000),
        startDate: new Date(Date.UTC(2026, 2, 25)),
        endDate: new Date(Date.UTC(2026, 2, 26)),
        status: 'PENDING',
        vehicleId: veiculo.id,
      },
    });

    await prisma.expense.create({
      data: {
        companyId,
        description: 'Diesel S10',
        amountCents: toCents(320.75 * escala),
        category: 'FUEL',
        date: new Date(Date.UTC(2026, 2, 15)),
        vehicleId: veiculo.id,
      },
    });
    await prisma.expense.create({
      data: {
        companyId,
        description: 'Revisao de 40 mil km',
        amountCents: toCents(1200 * escala),
        category: 'MAINTENANCE',
        date: new Date(Date.UTC(2026, 2, 16)),
        vehicleId: veiculo.id,
      },
    });

    return { alunoId: aluno.id, veiculoId: veiculo.id };
  });
}

describe('DRE', () => {
  it('bate centavo a centavo com os lancamentos do periodo', async () => {
    await montarCenario(alfa.id);
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.get(`/api/v1/financial/dre${PERIODO}`);
    expect(res.status).toBe(200);

    expect(res.body.receitas.mensalidades.cents).toBe(70_000);
    expect(res.body.receitas.fretamentos.cents).toBe(450_000);
    expect(res.body.receitas.total.cents).toBe(520_000);

    const porCategoria = Object.fromEntries(
      res.body.despesasPorCategoria.map((d: { categoria: string; valor: { cents: number } }) => [
        d.categoria,
        d.valor.cents,
      ]),
    );
    // Todas as categorias aparecem, inclusive zeradas: omitir sugeriria que a
    // categoria nao existe.
    expect(Object.keys(porCategoria).sort()).toEqual(['FUEL', 'MAINTENANCE', 'OTHER', 'PAYROLL', 'TAXES']);
    expect(porCategoria.FUEL).toBe(32_075);
    expect(porCategoria.MAINTENANCE).toBe(120_000);
    expect(porCategoria.PAYROLL).toBe(0);

    expect(res.body.despesaTotal.cents).toBe(152_075);
    expect(res.body.lucroLiquido.cents).toBe(367_925);
    expect(res.body.margemPercentual).toBe(70.75);
  });

  it('o DRE de uma empresa nao contem nada da outra', async () => {
    await montarCenario(alfa.id);
    await montarCenario(beta.id, 7); // valores 7x maiores: qualquer vazamento salta

    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    const daAlfa = await donoAlfa.get(`/api/v1/financial/dre${PERIODO}`);
    const daBeta = await donoBeta.get(`/api/v1/financial/dre${PERIODO}`);

    expect(daAlfa.body.receitas.total.cents).toBe(520_000);
    expect(daBeta.body.receitas.total.cents).toBe(520_000 * 7);
    expect(daAlfa.body.despesaTotal.cents).toBe(152_075);
    expect(daBeta.body.despesaTotal.cents).toBe(152_075 * 7);
  });

  it('ROI por veiculo so lista veiculos da propria empresa', async () => {
    const { veiculoId } = await montarCenario(alfa.id);
    await montarCenario(beta.id, 7);

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get(`/api/v1/financial/dre/by-vehicle${PERIODO}`);

    expect(res.status).toBe(200);
    expect(res.body.itens).toHaveLength(1);
    expect(res.body.itens[0].vehicleId).toBe(veiculoId);
    expect(res.body.itens[0].receita.cents).toBe(450_000);
    expect(res.body.itens[0].despesa.cents).toBe(152_075);
    expect(res.body.itens[0].resultado.cents).toBe(297_925);
  });

  it('recusa periodo com inicio depois do fim', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get('/api/v1/financial/dre?from=2026-03-31&to=2026-03-01');
    expect(res.status).toBe(422);
  });
});

describe('mensalidades', () => {
  it('lanca a mensalidade e da baixa manual, registrando a data do recebimento', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const aluno = await dono.post('/api/v1/students', {
      name: 'Ana Pagante',
      school: 'Escola',
      shift: 'FULL',
      monthlyFee: 480.5,
    });

    const lancada = await dono.post('/api/v1/financial/transactions', {
      studentId: aluno.body.id,
      amount: '480,50',
      dueDate: '2026-03-05',
    });
    expect(lancada.status).toBe(201);
    expect(lancada.body.amount.cents).toBe(48_050);
    expect(lancada.body.paid).toBe(false);
    expect(lancada.body.paidAt).toBeNull();

    const baixa = await dono.post(`/api/v1/financial/transactions/${lancada.body.id}/settle`);
    expect(baixa.status).toBe(200);
    expect(baixa.body.paid).toBe(true);
    expect(baixa.body.paidAt).not.toBeNull();

    const naTabela = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ paid: boolean; paidAt: Date | null }>>`
        SELECT paid, "paidAt" FROM "FinancialTransaction" WHERE id = ${lancada.body.id}`,
    );
    expect(naTabela[0]!.paid).toBe(true);
    expect(naTabela[0]!.paidAt).not.toBeNull();

    // Baixa em dobro e erro contabil, nao operacao idempotente silenciosa.
    const denovo = await dono.post(`/api/v1/financial/transactions/${lancada.body.id}/settle`);
    expect(denovo.status).toBe(409);
    expect(denovo.body.error.message).toContain('já consta como paga');
  });

  it('nao lanca mensalidade para aluno de outra empresa', async () => {
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const alunoBeta = await donoBeta.post('/api/v1/students', {
      name: 'Aluno Beta',
      school: 'Escola B',
      shift: 'FULL',
      monthlyFee: 300,
    });

    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const res = await donoAlfa.post('/api/v1/financial/transactions', {
      studentId: alunoBeta.body.id,
      amount: 300,
      dueDate: '2026-03-05',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Aluno');
  });
});

describe('despesas', () => {
  it('registra despesa com veiculo proprio e a soma aparece no DRE', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const veiculo = await dono.post('/api/v1/vehicles', { plate: 'ABC1D23', capacity: 20 });

    const res = await dono.post('/api/v1/financial/expenses', {
      description: 'Diesel S10',
      amount: 'R$ 320,75',
      category: 'FUEL',
      date: '2026-03-15',
      vehicleId: veiculo.body.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.amount.cents).toBe(32_075);

    const dre = await dono.get(`/api/v1/financial/dre${PERIODO}`);
    expect(dre.body.despesaTotal.cents).toBe(32_075);
  });

  it('recusa despesa atrelada a veiculo de outra empresa', async () => {
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const veiculoBeta = await donoBeta.post('/api/v1/vehicles', { plate: 'ZZZ9Z99', capacity: 12 });

    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const res = await donoAlfa.post('/api/v1/financial/expenses', {
      description: 'Pneu do vizinho',
      amount: 500,
      category: 'MAINTENANCE',
      vehicleId: veiculoBeta.body.id,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Veículo');

    const nenhuma = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Expense"`,
    );
    expect(Number(nenhuma[0]!.n)).toBe(0);
  });

  it('recusa valor monetario negativo', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/financial/expenses', {
      description: 'Estorno disfarcado',
      amount: -100,
      category: 'OTHER',
    });
    expect(res.status).toBe(422);
  });
});

describe('faturas no gateway', () => {
  it('sem ASAAS_API_KEY devolve 503 FEATURE_DISABLED e nao grava nada', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const aluno = await dono.post('/api/v1/students', {
      name: 'Ana Pagante',
      school: 'Escola',
      shift: 'FULL',
      monthlyFee: 480.5,
    });

    const res = await dono.post('/api/v1/financial/invoices', {
      studentId: aluno.body.id,
      amount: 480.5,
      dueDate: '2026-03-05',
      payerDocument: '11144477735',
      payerName: 'Responsavel Teste',
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    expect(res.body.error.message).toContain('não simula');

    // O ponto do teste: integracao desligada nao pode deixar rastro de fatura
    // falsa no banco. Foi assim que `companyId: 'mock-company'` nasceu.
    const invoices = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Invoice"`,
    );
    const transacoes = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "FinancialTransaction"`,
    );
    expect(Number(invoices[0]!.n)).toBe(0);
    expect(Number(transacoes[0]!.n)).toBe(0);
  });

  it('lista faturas apenas da propria empresa', async () => {
    await runUnscoped('fixture', async () => {
      for (const [companyId, nome] of [
        [alfa.id, 'Aluno Alfa'],
        [beta.id, 'Aluno Beta'],
      ] as const) {
        const s = await prisma.student.create({
          data: { companyId, name: nome, school: 'E', shift: 'FULL', monthlyFeeCents: 0 },
        });
        await prisma.invoice.create({
          data: {
            companyId,
            studentId: s.id,
            amountCents: toCents(480.5),
            status: 'PENDING',
            dueDate: new Date(Date.UTC(2026, 2, 5)),
          },
        });
      }
    });

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get('/api/v1/financial/invoices');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.items[0]).not.toHaveProperty('companyId');
  });
});

describe('folha apurada pelo ponto', () => {
  /*
   * O lucro aparecia sistematicamente maior do que e.
   *
   * O DRE e regime de caixa e so conta despesa lancada — o que esta certo e
   * reconcilia com o extrato. Mas a diaria do motorista so entrava se alguem
   * lembrasse de digitar: o trabalho aconteceu, o cartao de ponto esta fechado,
   * o custo existe, e o numero na tela ignorava tudo isso.
   *
   * A saida NAO foi somar a folha no lucro — isso contaria em dobro assim que o
   * lancamento fosse feito, trocando um numero errado por outro. Foi tornar a
   * omissao impossivel de nao ver.
   */
  async function motoristaComPonto(companyId: string, nome: string, diariaCents: number, dias: number) {
    return runUnscoped('fixture', async () => {
      const usuario = await prisma.user.create({
        data: {
          name: nome,
          email: `${nome.toLowerCase().replace(/ /g, '.')}@teste.com.br`,
          password: 'x',
          role: 'DRIVER',
          tenantId: companyId,
        },
      });
      const motorista = await prisma.driver.create({
        data: { companyId, userId: usuario.id, name: nome, dailyRateCents: diariaCents },
      });
      const veiculo = await prisma.vehicle.create({
        data: { companyId, plate: `PON${dias}A11`, model: 'Van', capacity: 15 },
      });
      for (let i = 0; i < dias; i += 1) {
        await prisma.timecard.create({
          data: {
            companyId,
            driverId: motorista.id,
            vehicleId: veiculo.id,
            date: new Date(Date.UTC(2026, 2, 2 + i)),
            status: 'COMPLETED',
          },
        });
      }
      return motorista;
    });
  }

  it('apura a diaria pelos cartoes fechados e mostra o que nao foi lancado', async () => {
    await montarCenario(alfa.id);
    // 18 dias x R$ 180,00 = R$ 3.240,00 de diaria devida no periodo.
    await motoristaComPonto(alfa.id, 'Carlos Ponto', toCents(180), 18);

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get(`/api/v1/financial/dre${PERIODO}`);

    expect(res.status).toBe(200);
    expect(res.body.folha.diasApurados).toBe(18);
    expect(res.body.folha.apuradaPeloPonto.cents).toBe(toCents(3240));
    // Nenhuma despesa PAYROLL foi lancada no cenario.
    expect(res.body.folha.lancadaComoDespesa.cents).toBe(0);
    expect(res.body.folha.naoLancada.cents).toBe(toCents(3240));

    // O lucro de caixa NAO muda: ele continua reconciliando com o extrato.
    // O segundo numero e que mostra o tamanho real do buraco.
    const lucroCaixa = res.body.lucroLiquido.cents;
    expect(res.body.lucroConsiderandoFolhaApurada.cents).toBe(lucroCaixa - toCents(3240));
  });

  it('folha lancada abate a apurada — nao conta duas vezes', async () => {
    await montarCenario(alfa.id);
    await motoristaComPonto(alfa.id, 'Carlos Ponto', toCents(180), 18);

    // O dono lanca a folha inteira como despesa, como deveria.
    await runUnscoped('fixture', () =>
      prisma.expense.create({
        data: {
          companyId: alfa.id,
          description: 'Diárias de março',
          category: 'PAYROLL',
          amountCents: toCents(3240),
          date: new Date(Date.UTC(2026, 2, 31)),
        },
      }),
    );

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get(`/api/v1/financial/dre${PERIODO}`);

    expect(res.body.folha.lancadaComoDespesa.cents).toBe(toCents(3240));
    expect(res.body.folha.naoLancada.cents).toBe(0);
    // Com tudo lancado, os dois lucros coincidem — que e o sinal de que o
    // financeiro esta em dia.
    expect(res.body.lucroConsiderandoFolhaApurada.cents).toBe(res.body.lucroLiquido.cents);
  });

  it('cartao em andamento nao vira diaria', async () => {
    await montarCenario(alfa.id);
    const motorista = await motoristaComPonto(alfa.id, 'Carlos Ponto', toCents(180), 3);

    await runUnscoped('fixture', async () => {
      const veiculo = await prisma.vehicle.findFirstOrThrow({ where: { companyId: alfa.id } });
      await prisma.timecard.create({
        data: {
          companyId: alfa.id,
          driverId: motorista.id,
          vehicleId: veiculo.id,
          date: new Date(Date.UTC(2026, 2, 20)),
          status: 'IN_PROGRESS',
        },
      });
    });

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get(`/api/v1/financial/dre${PERIODO}`);

    // Turno aberto pode terminar sem virar diaria (bateu entrada e foi embora).
    // Contar um dia que ainda nao acabou seria antecipar custo que talvez nao exista.
    expect(res.body.folha.diasApurados).toBe(3);
  });

  it('a folha de uma frota nao aparece no DRE da outra', async () => {
    await montarCenario(alfa.id);
    await motoristaComPonto(alfa.id, 'Carlos Ponto', toCents(180), 18);
    await montarCenario(beta.id);

    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const res = await donoBeta.get(`/api/v1/financial/dre${PERIODO}`);

    expect(res.body.folha.diasApurados).toBe(0);
    expect(res.body.folha.apuradaPeloPonto.cents).toBe(0);
  });
});

describe('exportacao para o contador', () => {
  it('devolve CSV com uma linha por lancamento e despesa negativa', async () => {
    await montarCenario(alfa.id);
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.get(`/api/v1/financial/export.csv${PERIODO}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const texto = res.text;
    // BOM: sem ele o Excel em portugues abre "José" como "JosÃ©".
    expect(texto.charCodeAt(0)).toBe(0xfeff);

    const linhas = texto.slice(1).split('\r\n');
    expect(linhas[0]).toBe('data;tipo;categoria;descricao;competencia;valor');

    // Despesa entra NEGATIVA: aberto na planilha, a coluna soma sozinha e da o
    // resultado do periodo. Com tudo positivo, quem abre precisa saber quais
    // linhas subtrair — e alguem sempre erra.
    const despesa = linhas.find((l) => l.includes('DESPESA'));
    expect(despesa, 'o periodo tem despesa').toBeTruthy();
    expect(despesa!.split(';').pop()).toMatch(/^-/);

    // Virgula decimal: ponto faz o Excel em pt-BR ler 480.50 como 480 mil.
    const receita = linhas.find((l) => l.includes('MENSALIDADE'));
    expect(receita!.split(';').pop()).toMatch(/^\d+,\d{2}$/);
  });

  it('texto que parece formula e desarmado antes de virar celula', () => {
    /*
     * O texto vem de quem digita. Uma despesa descrita como `=HYPERLINK(...)`
     * viraria codigo executavel ao abrir o arquivo na maquina do contador — e o
     * contador abre por confiar em quem mandou.
     *
     * Testado direto no escapador, e nao pela rota, porque o que se prova aqui e
     * a regra: quais entradas sao desarmadas e, tao importante quanto, quais
     * NAO podem ser. A primeira versao protegia tambem o valor negativo, e
     * `'-320,75` vira TEXTO na planilha: a coluna deixava de somar, e a defesa
     * quebrava exatamente o recurso que ela serve.
     */
    const perigosos = [
      '=HYPERLINK("http://ruim","clique")',
      '+1+1',
      '@SUM(A1:A9)',
      '-CMD|calc',
    ];
    for (const entrada of perigosos) {
      const saida = campoCsv(entrada);
      expect(saida.replace(/^"/, '').startsWith(String.fromCharCode(39)), entrada).toBe(true);
    }

    // Valor monetario negativo NAO pode ser desarmado: precisa continuar numero.
    for (const numero of ['-320,75', '-1,00', '480,50']) {
      expect(campoCsv(numero), numero).toBe(numero);
    }
  });

  it('gestor sem permissao de financeiro nao exporta', async () => {
    await criarUsuario(alfa, 'MANAGER', 'gestor.sem.financeiro@teste.com.br', {
      canManageFinance: false,
    });
    const gestor = await autenticar('gestor.sem.financeiro@teste.com.br');

    const res = await gestor.get(`/api/v1/financial/export.csv${PERIODO}`);
    expect(res.status).toBe(403);
  });
});
