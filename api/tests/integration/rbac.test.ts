import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { criarEmpresa, criarUsuario, autenticar, Cliente, type Empresa } from '../helpers/factory';

/**
 * Matriz de autorizacao.
 *
 * A regra 1 da arquitetura e "toda rota declara requireRole, inclusive GET",
 * porque foi uma rota sem guard que deixou o CRUD de alunos publico. Um teste
 * por rota nao cobre isso: o que cobre e a matriz — para CADA papel, em CADA
 * rota de escrita, qual e o status. Papel novo ou rota nova sem linha aqui fica
 * visivel na hora.
 *
 * Nas linhas PERMITIDAS a assercao nao e "200": e "nao foi barrado". O que se
 * verifica e a decisao do guard, e um 404/409 de regra de negocio tambem prova
 * que o pedido atravessou a autorizacao. 500 nao esta na lista de proposito —
 * erro de servidor nunca conta como autorizacao concedida.
 */

const PASSOU = [200, 201, 204, 402, 404, 409, 422];

let alfa: Empresa;
let studentId: string;
let vehicleId: string;

/** Papeis do cenario; a chave e o e-mail usado para autenticar. */
const PAPEIS = {
  OWNER: 'owner@teste.com.br',
  MANAGER_COMPLETO: 'manager.completo@teste.com.br',
  MANAGER_SEM_FINANCE: 'manager.sem.finance@teste.com.br',
  MANAGER_SEM_HR: 'manager.sem.hr@teste.com.br',
  MANAGER_SEM_ROUTES: 'manager.sem.routes@teste.com.br',
  MANAGER_SEM_NADA: 'manager.sem.nada@teste.com.br',
  DRIVER: 'driver@teste.com.br',
  ASSISTANT: 'assistant@teste.com.br',
  PARENT: 'parent@teste.com.br',
} as const;

type Papel = keyof typeof PAPEIS;

interface Caso {
  metodo: 'POST' | 'PATCH' | 'DELETE' | 'GET';
  rota: () => string;
  corpo?: () => unknown;
  /** Papeis que o guard tem de deixar passar. Todo o resto recebe 403. */
  permitidos: Papel[];
}

const CASOS: Record<string, Caso> = {
  'POST /students': {
    metodo: 'POST',
    rota: () => '/api/v1/students',
    corpo: () => ({ name: 'Novo Aluno', school: 'Escola', shift: 'FULL', monthlyFee: 100 }),
    permitidos: ['OWNER', 'MANAGER_COMPLETO', 'MANAGER_SEM_FINANCE', 'MANAGER_SEM_HR'],
  },
  'PATCH /students/:id/checkin': {
    metodo: 'PATCH',
    rota: () => `/api/v1/students/${studentId}/checkin`,
    corpo: () => ({ status: 'BOARDED' }),
    permitidos: [
      'OWNER',
      'MANAGER_COMPLETO',
      'MANAGER_SEM_FINANCE',
      'MANAGER_SEM_HR',
      'MANAGER_SEM_ROUTES',
      'MANAGER_SEM_NADA',
      'DRIVER',
      'ASSISTANT',
    ],
  },
  'DELETE /students/:id': {
    metodo: 'DELETE',
    rota: () => `/api/v1/students/${studentId}`,
    permitidos: ['OWNER'],
  },
  'POST /vehicles': {
    metodo: 'POST',
    rota: () => '/api/v1/vehicles',
    corpo: () => ({ plate: 'QQQ1Q11', capacity: 15 }),
    permitidos: ['OWNER', 'MANAGER_COMPLETO', 'MANAGER_SEM_FINANCE', 'MANAGER_SEM_HR'],
  },
  'DELETE /vehicles/:id': {
    metodo: 'DELETE',
    rota: () => `/api/v1/vehicles/${vehicleId}`,
    permitidos: ['OWNER'],
  },
  'POST /drivers': {
    metodo: 'POST',
    rota: () => '/api/v1/drivers',
    corpo: () => ({ name: 'Motorista Novo', dailyRate: 150 }),
    permitidos: ['OWNER', 'MANAGER_COMPLETO', 'MANAGER_SEM_FINANCE', 'MANAGER_SEM_ROUTES'],
  },
  'GET /financial/dre': {
    metodo: 'GET',
    rota: () => '/api/v1/financial/dre',
    permitidos: ['OWNER', 'MANAGER_COMPLETO', 'MANAGER_SEM_HR', 'MANAGER_SEM_ROUTES'],
  },
  'POST /financial/expenses': {
    metodo: 'POST',
    rota: () => '/api/v1/financial/expenses',
    corpo: () => ({ description: 'Despesa', amount: 10, category: 'OTHER' }),
    permitidos: ['OWNER', 'MANAGER_COMPLETO', 'MANAGER_SEM_HR', 'MANAGER_SEM_ROUTES'],
  },
  'DELETE /financial/expenses/:id': {
    metodo: 'DELETE',
    rota: () => '/api/v1/financial/expenses/00000000-0000-4000-8000-000000000000',
    permitidos: ['OWNER'],
  },
  'PATCH /company/me': {
    metodo: 'PATCH',
    rota: () => '/api/v1/company/me',
    corpo: () => ({ name: 'Empresa Renomeada' }),
    permitidos: ['OWNER'],
  },
  'GET /privacy/audit-trail': {
    metodo: 'GET',
    rota: () => '/api/v1/privacy/audit-trail',
    permitidos: ['OWNER'],
  },
  'GET /privacy/deletion-requests': {
    metodo: 'GET',
    rota: () => '/api/v1/privacy/deletion-requests',
    permitidos: ['OWNER'],
  },
};

async function chamar(cliente: Cliente, caso: Caso) {
  const url = caso.rota();
  const corpo = caso.corpo?.();
  switch (caso.metodo) {
    case 'GET':
      return cliente.get(url);
    case 'POST':
      return cliente.post(url, corpo);
    case 'PATCH':
      return cliente.patch(url, corpo);
    case 'DELETE':
      return cliente.delete(url);
  }
}

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');

  await criarUsuario(alfa, 'OWNER', PAPEIS.OWNER);
  await criarUsuario(alfa, 'MANAGER', PAPEIS.MANAGER_COMPLETO, {
    canManageFinance: true,
    canManageHR: true,
    canManageRoutes: true,
  });
  await criarUsuario(alfa, 'MANAGER', PAPEIS.MANAGER_SEM_FINANCE, {
    canManageFinance: false,
    canManageHR: true,
    canManageRoutes: true,
  });
  await criarUsuario(alfa, 'MANAGER', PAPEIS.MANAGER_SEM_HR, {
    canManageFinance: true,
    canManageHR: false,
    canManageRoutes: true,
  });
  await criarUsuario(alfa, 'MANAGER', PAPEIS.MANAGER_SEM_ROUTES, {
    canManageFinance: true,
    canManageHR: true,
    canManageRoutes: false,
  });
  await criarUsuario(alfa, 'MANAGER', PAPEIS.MANAGER_SEM_NADA, {
    canManageFinance: false,
    canManageHR: false,
    canManageRoutes: false,
  });
  const usuarioDriver = await criarUsuario(alfa, 'DRIVER', PAPEIS.DRIVER);
  await criarUsuario(alfa, 'ASSISTANT', PAPEIS.ASSISTANT);
  await criarUsuario(alfa, 'PARENT', PAPEIS.PARENT);

  await runUnscoped('fixture', async () => {
    const aluno = await prisma.student.create({
      data: { companyId: alfa.id, name: 'Aluno Base', school: 'Escola', shift: 'FULL', monthlyFeeCents: 10_000 },
    });
    const veiculo = await prisma.vehicle.create({
      data: { companyId: alfa.id, plate: 'BAS1E00', model: 'Sprinter', capacity: 20 },
    });
    await prisma.driver.create({
      data: { companyId: alfa.id, name: 'Motorista Base', userId: usuarioDriver.id, dailyRateCents: 18_000 },
    });
    studentId = aluno.id;
    vehicleId = veiculo.id;
  });
});

describe('matriz papel x rota de escrita', () => {
  for (const [nome, caso] of Object.entries(CASOS)) {
    for (const papel of Object.keys(PAPEIS) as Papel[]) {
      const deveriaPassar = caso.permitidos.includes(papel);
      it(`${nome} — ${papel} ${deveriaPassar ? 'passa pelo guard' : 'recebe 403'}`, async () => {
        const cliente = await autenticar(PAPEIS[papel]);
        const res = await chamar(cliente, caso);

        if (deveriaPassar) {
          expect(autorizacaoConcedida(res.status)).toBe(true);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      });
    }
  }
});

/** Lanca em vez de devolver false: assim a falha mostra o status recebido. */
function autorizacaoConcedida(status: number): boolean {
  if (PASSOU.includes(status)) return true;
  throw new Error(`status ${status} nao e resultado de autorizacao concedida (esperado um de ${PASSOU.join(', ')})`);
}

describe('permissao granular do MANAGER', () => {
  it('MANAGER sem canManageFinance recebe 403 no DRE e o com a flag entra', async () => {
    const semFlag = await autenticar(PAPEIS.MANAGER_SEM_FINANCE);
    const comFlag = await autenticar(PAPEIS.MANAGER_COMPLETO);

    const negado = await semFlag.get('/api/v1/financial/dre');
    expect(negado.status).toBe(403);
    expect(negado.body.error.message).toContain('permissão administrativa');
    // A negacao nao pode vir acompanhada de amostra do relatorio.
    expect(negado.body).not.toHaveProperty('receitas');

    const permitido = await comFlag.get('/api/v1/financial/dre');
    expect(permitido.status).toBe(200);
    expect(permitido.body.receitas.total.cents).toBe(0);
  });

  it('a flag vem do banco: revoga-la vale na requisicao seguinte, sem novo login', async () => {
    const gestor = await autenticar(PAPEIS.MANAGER_COMPLETO);
    expect((await gestor.get('/api/v1/financial/dre')).status).toBe(200);

    await runUnscoped('fixture', () =>
      prisma.userCompany.updateMany({
        where: { user: { email: PAPEIS.MANAGER_COMPLETO } },
        data: { canManageFinance: false },
      }),
    );

    // Sem relogar: a permissao e estado atual, nao claim congelada no token.
    expect((await gestor.get('/api/v1/financial/dre')).status).toBe(403);
  });
});

describe('vinculo arquivado', () => {
  it('quem foi desligado continua consultando o historico e nao escreve mais', async () => {
    // OWNER de proposito: com MANAGER, o 403 de DELETE viria do requireRole
    // ('OWNER') e o teste passaria sem nunca exercitar a trava de vinculo
    // arquivado, que e o assunto daqui.
    await criarUsuario(alfa, 'OWNER', 'desligado@teste.com.br');
    const desligado = await autenticar('desligado@teste.com.br');

    // Antes do desligamento escreve normalmente.
    expect((await desligado.post('/api/v1/vehicles', { plate: 'AAA1A11', capacity: 10 })).status).toBe(201);

    await runUnscoped('fixture', () =>
      prisma.userCompany.updateMany({
        where: { user: { email: 'desligado@teste.com.br' } },
        data: { status: 'ARCHIVED', leftAt: new Date() },
      }),
    );

    // Leitura segue: o historico e a defesa da empresa em processo trabalhista.
    const leitura = await desligado.get('/api/v1/vehicles');
    expect(leitura.status).toBe(200);
    expect(leitura.body.meta.total).toBe(2);

    for (const [status, res] of [
      ['POST', await desligado.post('/api/v1/vehicles', { plate: 'BBB2B22', capacity: 10 })],
      ['PATCH', await desligado.patch(`/api/v1/students/${studentId}`, { school: 'Outra' })],
      ['DELETE', await desligado.delete(`/api/v1/vehicles/${vehicleId}`)],
    ] as const) {
      expect(res.status, `${status} deveria ser barrado`).toBe(403);
      expect(res.body.error.message).toContain('arquivado');
    }

    const criados = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Vehicle" WHERE plate = 'BBB2B22'`,
    );
    expect(Number(criados[0]!.n)).toBe(0);
  });
});

describe('responsavel', () => {
  it('PARENT le o que e dele e e barrado em toda rota de gestao', async () => {
    const pai = await autenticar(PAPEIS.PARENT);

    expect((await pai.get('/api/v1/students')).status).toBe(200);
    expect((await pai.get('/api/v1/privacy/my-data')).status).toBe(200);
    expect((await pai.get('/api/v1/privacy/export')).status).toBe(200);

    for (const rota of [
      '/api/v1/drivers',
      '/api/v1/vehicles',
      '/api/v1/timecards',
      '/api/v1/financial/dre',
      '/api/v1/financial/transactions',
      '/api/v1/privacy/audit-trail',
    ]) {
      const res = await pai.get(rota);
      expect(res.status, `GET ${rota}`).toBe(403);
    }
  });
});

describe('sem sessao', () => {
  it('rota autenticada sem cookie devolve 401, nunca 200 vazio', async () => {
    const anonimo = new Cliente();

    for (const rota of ['/api/v1/students', '/api/v1/vehicles', '/api/v1/financial/dre', '/api/v1/auth/me']) {
      const res = await anonimo.get(rota);
      expect(res.status, `GET ${rota}`).toBe(401);
      expect(res.body).not.toHaveProperty('items');
    }
  });
});
