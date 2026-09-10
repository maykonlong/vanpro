import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { criarEmpresa, criarUsuario, autenticar, Cliente, type Empresa } from '../helpers/factory';

/**
 * Motorista freelancer: a mesma pessoa em duas frotas.
 *
 * O README anuncia isso como feature de capa — *"um motorista pode estar
 * vinculado a Frota A pela manha e a Frota B a tarde"* — e o seed exercita o
 * caso. Nao funcionava: `User.tenantId` era um escalar, entao a sessao sempre
 * resolvia para a primeira frota e o segundo vinculo em `UserCompany` era linha
 * morta no banco. `Driver.userId` tambem era unico global, o que impedia diaria
 * diferente em cada empresa.
 *
 * Agora a empresa ativa e propriedade da SESSAO. Estes testes existem para que
 * ninguem volte a amarrar autorizacao ao usuario.
 */

let alfa: Empresa;
let beta: Empresa;

const FREELA = 'joana.freela@teste.com.br';

beforeEach(async () => {
  alfa = await criarEmpresa('Frota Alfa', '11222333000181');
  beta = await criarEmpresa('Frota Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
});

/** Cria a pessoa com vinculo nas duas empresas, com papel diferente em cada. */
async function criarFreelancer(papelAlfa: 'DRIVER' | 'OWNER' = 'DRIVER', papelBeta: 'DRIVER' | 'MANAGER' = 'DRIVER') {
  const usuario = await criarUsuario(alfa, papelAlfa, FREELA);
  await runUnscoped('fixture', () =>
    prisma.userCompany.create({
      data: {
        userId: usuario.id,
        companyId: beta.id,
        role: papelBeta,
        status: 'ACTIVE',
        contractType: 'FREELANCE',
      },
    }),
  );
  return usuario;
}

describe('login com mais de um vinculo', () => {
  it('nao emite sessao sozinho: devolve a lista de empresas para escolher', async () => {
    await criarFreelancer();

    const c = new Cliente();
    const res = await c.login(FREELA);

    expect(res.status).toBe(200);
    expect(res.body.requiresCompanySelection).toBe(true);
    expect(res.body.companies).toHaveLength(2);
    expect(res.body.companies.map((e: { companyName: string }) => e.companyName).sort()).toEqual([
      'Frota Alfa',
      'Frota Beta',
    ]);
    expect(typeof res.body.selectionToken).toBe('string');

    // A escolha e um passo, e nao um detalhe: enquanto ela nao acontece nao ha
    // sessao, para ninguem agir na frota errada sem perceber.
    expect(res.headers['set-cookie']?.join(' ') ?? '').not.toContain('access_token=ey');
  });

  it('entra na empresa escolhida e enxerga apenas o dado dela', async () => {
    await criarFreelancer();
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    await donoAlfa.post('/api/v1/vehicles', { plate: 'AAA1A11', capacity: 15 });
    await donoBeta.post('/api/v1/vehicles', { plate: 'BBB2B22', capacity: 20 });

    const c = new Cliente();
    const login = await c.login(FREELA);
    const escolha = await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: alfa.id,
    });
    expect(escolha.status).toBe(200);

    const naAlfa = await c.get('/api/v1/vehicles');
    expect(naAlfa.status).toBe(200);
    expect(naAlfa.body.items.map((v: { plate: string }) => v.plate)).toEqual(['AAA1A11']);
  });

  it('recusa empresa em que a pessoa nao tem vinculo', async () => {
    const usuario = await criarUsuario(alfa, 'DRIVER', FREELA);
    await runUnscoped('fixture', () =>
      prisma.userCompany.create({
        data: { userId: usuario.id, companyId: beta.id, role: 'DRIVER', status: 'ACTIVE' },
      }),
    );

    const outra = await criarEmpresa('Frota Alheia', '77888999000122');

    const c = new Cliente();
    const login = await c.login(FREELA);
    const res = await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: outra.id,
    });

    expect(res.status).toBe(403);
  });
});

describe('troca de empresa sem novo login', () => {
  it('muda o que a pessoa enxerga', async () => {
    await criarFreelancer();
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    await donoAlfa.post('/api/v1/vehicles', { plate: 'AAA1A11', capacity: 15 });
    await donoBeta.post('/api/v1/vehicles', { plate: 'BBB2B22', capacity: 20 });

    const c = new Cliente();
    const login = await c.login(FREELA);
    await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: alfa.id,
    });

    expect((await c.get('/api/v1/vehicles')).body.items[0].plate).toBe('AAA1A11');

    const troca = await c.post('/api/v1/auth/switch-company', { companyId: beta.id });
    expect(troca.status).toBe(200);

    expect((await c.get('/api/v1/vehicles')).body.items[0].plate).toBe('BBB2B22');
  });

  it('o papel vem do vinculo da empresa ativa, nao do usuario', async () => {
    // Dona da Alfa, motorista na Beta. O que ela pode fazer muda com a frota.
    await criarFreelancer('OWNER', 'DRIVER');

    const c = new Cliente();
    const login = await c.login(FREELA);
    await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: alfa.id,
    });

    const comoDona = await c.get('/api/v1/auth/me');
    expect(comoDona.body.role).toBe('OWNER');
    expect((await c.post('/api/v1/vehicles', { plate: 'CCC3C33', capacity: 12 })).status).toBe(201);

    await c.post('/api/v1/auth/switch-company', { companyId: beta.id });

    const comoMotorista = await c.get('/api/v1/auth/me');
    expect(comoMotorista.body.role).toBe('DRIVER');
    expect((await c.post('/api/v1/vehicles', { plate: 'DDD4D44', capacity: 12 })).status).toBe(403);
  });

  it('recusa trocar para empresa sem vinculo', async () => {
    await criarFreelancer();
    const outra = await criarEmpresa('Frota Alheia', '77888999000122');

    const c = new Cliente();
    const login = await c.login(FREELA);
    await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: alfa.id,
    });

    expect((await c.post('/api/v1/auth/switch-company', { companyId: outra.id })).status).toBe(403);
  });

  it('revoga a sessao anterior: o token antigo nao volta a valer na frota antiga', async () => {
    await criarFreelancer();

    const c = new Cliente();
    const login = await c.login(FREELA);
    await c.post('/api/v1/auth/select-company', {
      selectionToken: login.body.selectionToken,
      companyId: alfa.id,
    });

    const sessoesAntes = await runUnscoped('check', () =>
      prisma.session.findMany({ where: { companyId: alfa.id }, select: { id: true } }),
    );
    expect(sessoesAntes.length).toBeGreaterThan(0);

    await c.post('/api/v1/auth/switch-company', { companyId: beta.id });

    // A troca e um corte, nao uma edicao: a familia da frota anterior morre,
    // para nenhum access token de 15 minutos sobreviver apontando para ela.
    const revogadas = await runUnscoped('check', () =>
      prisma.session.findMany({
        where: { companyId: alfa.id, revokedAt: null },
        select: { id: true },
      }),
    );
    expect(revogadas).toHaveLength(0);
  });
});

describe('cadastro de motorista por empresa', () => {
  it('a mesma pessoa tem diaria diferente em cada frota', async () => {
    const usuario = await criarFreelancer();

    await runUnscoped('fixture', async () => {
      await prisma.driver.create({
        data: { companyId: alfa.id, userId: usuario.id, name: 'Joana', dailyRateCents: 20_000 },
      });
      await prisma.driver.create({
        data: { companyId: beta.id, userId: usuario.id, name: 'Joana', dailyRateCents: 16_000 },
      });
    });

    const cadastros = await runUnscoped('check', () =>
      prisma.driver.findMany({ where: { userId: usuario.id }, orderBy: { dailyRateCents: 'desc' } }),
    );

    expect(cadastros).toHaveLength(2);
    expect(cadastros.map((d) => d.dailyRateCents)).toEqual([20_000, 16_000]);
  });
});

describe('login com um unico vinculo', () => {
  it('entra direto, sem passo de escolha', async () => {
    const c = new Cliente();
    const res = await c.login('dono.alfa@teste.com.br');

    expect(res.status).toBe(200);
    expect(res.body.requiresCompanySelection).toBeUndefined();
    expect(res.body.user.email).toBe('dono.alfa@teste.com.br');
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('sem vinculo nenhum, nao entra', async () => {
    const orfa = await criarEmpresa('Frota Orfa', '99888777000166');
    const usuario = await criarUsuario(orfa, 'DRIVER', 'sem.vinculo@teste.com.br');

    await runUnscoped('fixture', () =>
      prisma.userCompany.deleteMany({ where: { userId: usuario.id } }),
    );

    const res = await new Cliente().login('sem.vinculo@teste.com.br');
    expect(res.status).toBe(403);
  });
});
