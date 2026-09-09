import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import { criarEmpresa, criarUsuario, autenticar, type Empresa, type Usuario } from '../helpers/factory';

/**
 * Alunos — o modulo de referencia do projeto.
 *
 * Alem do CRUD, o que precisa ser verdade aqui: o responsavel so alcanca os
 * proprios filhos, o auxiliar registra embarque mas nao cria cadastro, o
 * motorista nao mexe em mensalidade, e nem o dono apaga aluno com fatura em
 * aberto — o historico fiscal vale mais que a faxina no cadastro.
 */

let alfa: Empresa;
let mae: Usuario;

const ALUNO_BASE = {
  school: 'Colegio Sao Bento',
  shift: 'MORNING' as const,
  monthlyFee: 480.5,
};

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  mae = await criarUsuario(alfa, 'PARENT', 'mae@teste.com.br');
});

describe('CRUD', () => {
  it('cria, le, atualiza e remove logicamente o aluno', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const criado = await dono.post('/api/v1/students', {
      ...ALUNO_BASE,
      name: "Ana D'Avila",
      grade: '3o ano',
      lgpdConsent: true,
    });
    expect(criado.status).toBe(201);
    expect(criado.body.name).toBe("Ana D'Avila");
    // Dinheiro sai em centavos + formatado; nunca em float solto.
    expect(criado.body.monthlyFee).toEqual({ cents: 48050, formatted: expect.stringContaining('480,50') });
    // Serializador explicito: coluna interna nao pode vazar na resposta.
    expect(criado.body).not.toHaveProperty('companyId');
    expect(criado.body).not.toHaveProperty('deletedAt');

    const id: string = criado.body.id;

    const lido = await dono.get(`/api/v1/students/${id}`);
    expect(lido.status).toBe(200);
    expect(lido.body.school).toBe('Colegio Sao Bento');

    const alterado = await dono.patch(`/api/v1/students/${id}`, { school: 'Escola Nova', monthlyFee: 500 });
    expect(alterado.status).toBe(200);
    expect(alterado.body.school).toBe('Escola Nova');
    expect(alterado.body.monthlyFee.cents).toBe(50000);

    const removido = await dono.delete(`/api/v1/students/${id}`);
    expect(removido.status).toBe(204);
    expect((await dono.get(`/api/v1/students/${id}`)).status).toBe(404);

    // Exclusao logica: a linha continua na tabela para o historico fiscal.
    const naTabela = await runUnscoped(
      'check',
      () => prisma.$queryRaw<Array<{ deletedAt: Date | null }>>`SELECT "deletedAt" FROM "Student" WHERE id = ${id}`,
    );
    expect(naTabela).toHaveLength(1);
    expect(naTabela[0]!.deletedAt).not.toBeNull();
  });

  it('recusa cadastro sem os campos obrigatorios', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/students', { name: 'Sem escola' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { campo: string }) => d.campo)).toEqual(
      expect.arrayContaining(['body.school', 'body.shift', 'body.monthlyFee']),
    );
  });

  it('ignora campo fora do schema em vez de deixar virar mass-assignment', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/students', {
      ...ALUNO_BASE,
      name: 'Bruno Silva',
      // Nao existe no schema de entrada: nao pode chegar ao Prisma nem a resposta.
      status: 'DELIVERED',
      deleteRequestStatus: 'DELETED',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.deleteRequestStatus).toBe('NONE');
  });
});

describe('paginacao', () => {
  it('devolve meta coerente com 25 alunos cadastrados', async () => {
    await runUnscoped('fixture', async () => {
      for (let i = 0; i < 25; i++) {
        await prisma.student.create({
          data: {
            companyId: alfa.id,
            name: `Aluno ${String(i).padStart(2, '0')}`,
            school: 'Escola Central',
            shift: 'FULL',
            monthlyFeeCents: toCents(300),
          },
        });
      }
    });

    const dono = await autenticar('dono.alfa@teste.com.br');

    const primeira = await dono.get('/api/v1/students?page=1&perPage=10');
    expect(primeira.status).toBe(200);
    expect(primeira.body.items).toHaveLength(10);
    expect(primeira.body.meta).toEqual({ page: 1, perPage: 10, total: 25, totalPages: 3, hasNext: true });

    const ultima = await dono.get('/api/v1/students?page=3&perPage=10');
    expect(ultima.body.items).toHaveLength(5);
    expect(ultima.body.meta.hasNext).toBe(false);

    // Teto do perPage: listagem sem limite e o DoS que o proprio cliente causa.
    const acimaDoTeto = await dono.get('/api/v1/students?perPage=5000');
    expect(acimaDoTeto.status).toBe(422);
  });
});

describe('papeis', () => {
  it('PARENT so enxerga os proprios filhos, na lista e no acesso direto', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const meuFilho = await dono.post('/api/v1/students', {
      ...ALUNO_BASE,
      name: 'Filho da Mae',
      parentId: mae.id,
    });
    expect(meuFilho.status).toBe(201);

    const deOutraFamilia = await dono.post('/api/v1/students', {
      ...ALUNO_BASE,
      name: 'Crianca de Outra Familia',
    });
    expect(deOutraFamilia.status).toBe(201);

    const cliente = await autenticar('mae@teste.com.br');
    const lista = await cliente.get('/api/v1/students');
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(1);
    expect(lista.body.items[0].name).toBe('Filho da Mae');

    // 404 e nao 403: 403 confirmaria que o cadastro daquela crianca existe.
    const direto = await cliente.get(`/api/v1/students/${deOutraFamilia.body.id}`);
    expect(direto.status).toBe(404);
  });

  it('ASSISTANT registra embarque mas nao cadastra aluno', async () => {
    await criarUsuario(alfa, 'ASSISTANT', 'monitor@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');
    const aluno = await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Carlos Embarcado' });

    const monitor = await autenticar('monitor@teste.com.br');

    const checkin = await monitor.patch(`/api/v1/students/${aluno.body.id}/checkin`, { status: 'BOARDED' });
    expect(checkin.status).toBe(200);
    expect(checkin.body.status).toBe('BOARDED');

    const tentativa = await monitor.post('/api/v1/students', { ...ALUNO_BASE, name: 'Cadastro Proibido' });
    expect(tentativa.status).toBe(403);
    expect(tentativa.body.error.code).toBe('FORBIDDEN');

    const total = await runUnscoped('check', () => prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Student"`);
    expect(Number(total[0]!.n)).toBe(1);
  });

  it('DRIVER nao altera a mensalidade do aluno', async () => {
    await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');
    const aluno = await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Daniel Passageiro' });

    const motorista = await autenticar('motorista@teste.com.br');
    const tentativa = await motorista.patch(`/api/v1/students/${aluno.body.id}`, { monthlyFee: 1 });
    expect(tentativa.status).toBe(403);

    const intacto = await dono.get(`/api/v1/students/${aluno.body.id}`);
    expect(intacto.body.monthlyFee.cents).toBe(toCents(ALUNO_BASE.monthlyFee));
  });
});

describe('regras de negocio', () => {
  it('recusa a exclusao logica enquanto houver fatura em aberto', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const aluno = await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Elisa Devedora' });
    const studentId: string = aluno.body.id;

    await runUnscoped('fixture', () =>
      prisma.invoice.create({
        data: {
          companyId: alfa.id,
          studentId,
          amountCents: toCents(480.5),
          status: 'PENDING',
          dueDate: new Date(),
        },
      }),
    );

    const res = await dono.delete(`/api/v1/students/${studentId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('1 fatura(s) em aberto');

    // E continua visivel: recusar a exclusao nao pode deixar o cadastro num
    // meio-termo em que ele some da lista mas segue existindo.
    expect((await dono.get(`/api/v1/students/${studentId}`)).status).toBe(200);
  });

  it('barra o cadastro que passa do teto do plano', async () => {
    const apertada = await criarEmpresa('Empresa Apertada', '55666777000188', {
      limites: { maxStudents: 2 },
    });
    await criarUsuario(apertada, 'OWNER', 'dono.apertada@teste.com.br');
    const dono = await autenticar('dono.apertada@teste.com.br');

    expect((await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Primeiro' })).status).toBe(201);
    expect((await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Segundo' })).status).toBe(201);

    const terceiro = await dono.post('/api/v1/students', { ...ALUNO_BASE, name: 'Terceiro' });
    expect(terceiro.status).toBe(402);
    expect(terceiro.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(terceiro.body.error.message).toContain('2 alunos');

    const cadastrados = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Student" WHERE "companyId" = ${apertada.id}`,
    );
    expect(Number(cadastrados[0]!.n)).toBe(2);
  });

  it('nao aceita responsavel de outra empresa como parentId', async () => {
    const beta = await criarEmpresa('Empresa Beta', '44555666000199');
    const maeDaBeta = await criarUsuario(beta, 'PARENT', 'mae.beta@teste.com.br');

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/students', {
      ...ALUNO_BASE,
      name: 'Aluno Contrabandeado',
      parentId: maeDaBeta.id,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Responsável');
  });
});
