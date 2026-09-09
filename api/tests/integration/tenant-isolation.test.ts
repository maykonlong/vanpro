import { describe, it, expect, beforeEach } from 'vitest';
import { prisma, TenantContextMissingError, CrossTenantWriteError } from '../../src/lib/prisma';
import { runUnscoped, runWithContext } from '../../src/lib/request-context';
import { criarEmpresa, criarUsuario, autenticar, type Empresa } from '../helpers/factory';
import { toCents } from '../../src/lib/money';

/**
 * Isolamento entre empresas.
 *
 * Este e o arquivo mais importante da suite. A versao anterior do sistema
 * anunciava "isolamento absoluto, nivel militar" e agregava o DRE sem filtro
 * nenhum: uma empresa via o faturamento de todas as outras. Nao havia um unico
 * teste tentando atravessar — o defeito era invisivel porque ninguem procurou.
 *
 * Aqui toda leitura e escrita e testada dos DOIS lados: o que a empresa dona
 * ve, e o que a empresa vizinha NAO ve.
 */

let alfa: Empresa;
let beta: Empresa;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  beta = await criarEmpresa('Empresa Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
});

describe('camada de dados', () => {
  it('recusa query em modelo de empresa sem contexto de tenant', async () => {
    // Fail-closed: "nao sei de quem e esse dado" nunca vira "entao mostra tudo".
    await expect(
      runWithContext({ tenantId: null, userId: null, role: null, requestId: 'teste', unscoped: false }, () =>
        prisma.student.findMany(),
      ),
    ).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it('injeta o filtro de empresa em findMany sem where', async () => {
    await runUnscoped('fixture', async () => {
      await prisma.student.create({
        data: { companyId: alfa.id, name: 'Aluno Alfa', school: 'Escola A', shift: 'MORNING', monthlyFeeCents: 0 },
      });
      await prisma.student.create({
        data: { companyId: beta.id, name: 'Aluno Beta', school: 'Escola B', shift: 'MORNING', monthlyFeeCents: 0 },
      });
    });

    const vistosPorAlfa = await runWithContext(
      { tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false },
      () => prisma.student.findMany(),
    );

    expect(vistosPorAlfa).toHaveLength(1);
    expect(vistosPorAlfa[0]!.name).toBe('Aluno Alfa');
  });

  it('converte findUnique em busca escopada — id de outra empresa devolve null', async () => {
    const alunoBeta = await runUnscoped('fixture', () =>
      prisma.student.create({
        data: { companyId: beta.id, name: 'Aluno Beta', school: 'Escola B', shift: 'FULL', monthlyFeeCents: 0 },
      }),
    );

    const achado = await runWithContext(
      { tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false },
      () => prisma.student.findUnique({ where: { id: alunoBeta.id } }),
    );

    expect(achado).toBeNull();
  });

  it('nao atualiza registro de outra empresa mesmo com o id correto', async () => {
    const alunoBeta = await runUnscoped('fixture', () =>
      prisma.student.create({
        data: { companyId: beta.id, name: 'Aluno Beta', school: 'Escola B', shift: 'FULL', monthlyFeeCents: 0 },
      }),
    );

    // Afirmamos o CODIGO do erro, e nao apenas "lancou". Enquanto o guard
    // embrulhava o `where` de update em `AND`, este teste passava pelo motivo
    // errado: o Prisma recusava a query por falta de campo unico na raiz, e o
    // isolamento nunca chegava a ser exercitado. "Deu erro" nao e prova de que
    // deu o erro certo.
    await expect(
      runWithContext({ tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false }, () =>
        prisma.student.update({ where: { id: alunoBeta.id }, data: { school: 'Invadida' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });

    const intacto = await runUnscoped('check', () =>
      prisma.student.findUnique({ where: { id: alunoBeta.id } }),
    );
    expect(intacto!.school).toBe('Escola B');
  });

  it('bloqueia escrita com companyId divergente do contexto', async () => {
    await expect(
      runWithContext({ tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false }, () =>
        prisma.student.create({
          data: { companyId: beta.id, name: 'Contrabando', school: 'X', shift: 'FULL', monthlyFeeCents: 0 },
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantWriteError);
  });

  it('agregacao respeita a empresa — o defeito que vazava o DRE', async () => {
    await runUnscoped('fixture', async () => {
      const a = await prisma.student.create({
        data: { companyId: alfa.id, name: 'A', school: 'E', shift: 'FULL', monthlyFeeCents: toCents(100) },
      });
      const b = await prisma.student.create({
        data: { companyId: beta.id, name: 'B', school: 'E', shift: 'FULL', monthlyFeeCents: toCents(900) },
      });
      await prisma.financialTransaction.create({
        data: { companyId: alfa.id, studentId: a.id, amountCents: toCents(100), paid: true, dueDate: new Date() },
      });
      await prisma.financialTransaction.create({
        data: { companyId: beta.id, studentId: b.id, amountCents: toCents(900), paid: true, dueDate: new Date() },
      });
    });

    const soma = await runWithContext(
      { tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false },
      () => prisma.financialTransaction.aggregate({ _sum: { amountCents: true } }),
    );

    expect(soma._sum.amountCents).toBe(toCents(100));
  });

  it('soft delete some da leitura sem apagar a linha', async () => {
    const aluno = await runUnscoped('fixture', () =>
      prisma.student.create({
        data: { companyId: alfa.id, name: 'Sumido', school: 'E', shift: 'FULL', monthlyFeeCents: 0, deletedAt: new Date() },
      }),
    );

    const lista = await runWithContext(
      { tenantId: alfa.id, userId: null, role: 'OWNER', requestId: 't', unscoped: false },
      () => prisma.student.findMany(),
    );
    expect(lista).toHaveLength(0);

    // Conferido em SQL cru de proposito: passar pelo client seria testar a
    // extensao contra ela mesma. O que precisa ser verdade e que a LINHA
    // continua na tabela — e o historico fiscal e trabalhista depende disso.
    const naTabela = await runUnscoped(
      'check',
      () => prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Student" WHERE id = ${aluno.id}`,
    );
    expect(naTabela).toHaveLength(1);
  });
});

describe('camada HTTP', () => {
  it('dono da Alfa nao enxerga aluno da Beta pela API', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    const criado = await donoBeta.post('/api/v1/students', {
      name: 'Sofia Beta',
      school: 'Instituto Aurora',
      shift: 'AFTERNOON',
      monthlyFee: 430,
    });
    expect(criado.status).toBe(201);

    const lista = await donoAlfa.get('/api/v1/students');
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(0);

    // 404 e nao 403: 403 confirmaria que o id existe em algum lugar.
    const direto = await donoAlfa.get(`/api/v1/students/${criado.body.id}`);
    expect(direto.status).toBe(404);
  });

  it('nao permite alterar aluno de outra empresa', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    const criado = await donoBeta.post('/api/v1/students', {
      name: 'Sofia Beta',
      school: 'Instituto Aurora',
      shift: 'AFTERNOON',
      monthlyFee: 430,
    });

    const tentativa = await donoAlfa.patch(`/api/v1/students/${criado.body.id}`, { school: 'Invadida' });
    expect(tentativa.status).toBe(404);

    const conferencia = await donoBeta.get(`/api/v1/students/${criado.body.id}`);
    expect(conferencia.body.school).toBe('Instituto Aurora');
  });
});
