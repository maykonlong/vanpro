import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import { criarEmpresa, criarUsuario, autenticar, type Empresa } from '../helpers/factory';

/**
 * Frota: veiculos e motoristas.
 *
 * Dois pontos merecem o teste mais duro daqui. A placa e unica por EMPRESA, e
 * nao globalmente — unicidade global vazaria a existencia do veiculo do
 * concorrente pelo proprio 409. E o holerite do motorista e um documento
 * pessoal: pedir o de outro devolve 404, e nem o proprio pode conter o preco do
 * fretamento, que e faturamento da empresa.
 */

let alfa: Empresa;
let beta: Empresa;

const VEICULO = { plate: 'ABC1D23', model: 'Sprinter 415', capacity: 20 };

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  beta = await criarEmpresa('Empresa Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
});

describe('veiculos', () => {
  it('cria, le e lista o veiculo da propria empresa', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const criado = await dono.post('/api/v1/vehicles', { ...VEICULO, km: 12000 });
    expect(criado.status).toBe(201);
    expect(criado.body.plate).toBe('ABC1D23');
    expect(criado.body.status).toBe('IDLE');
    expect(criado.body).not.toHaveProperty('companyId');

    const lido = await dono.get(`/api/v1/vehicles/${criado.body.id}`);
    expect(lido.status).toBe(200);
    expect(lido.body.km).toBe(12000);

    const lista = await dono.get('/api/v1/vehicles');
    expect(lista.body.items).toHaveLength(1);
    expect(lista.body.meta.total).toBe(1);
  });

  it('atualiza modelo e capacidade', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const criado = await dono.post('/api/v1/vehicles', VEICULO);

    const res = await dono.patch(`/api/v1/vehicles/${criado.body.id}`, {
      model: 'Master 16L',
      capacity: 16,
    });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('Master 16L');
    expect(res.body.capacity).toBe(16);
  });

  it('recusa placa fora do padrao Mercosul ou antigo', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    for (const plate of ['AB1234', 'ABCD123', '1234ABC', '']) {
      const res = await dono.post('/api/v1/vehicles', { ...VEICULO, plate });
      expect(res.status).toBe(422);
      expect(res.body.error.details.some((d: { campo: string }) => d.campo === 'body.plate')).toBe(true);
    }

    const nenhum = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Vehicle"`,
    );
    expect(Number(nenhum[0]!.n)).toBe(0);
  });

  it('barra placa repetida na mesma empresa mas aceita a mesma placa em outra', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    expect((await donoAlfa.post('/api/v1/vehicles', VEICULO)).status).toBe(201);

    const repetida = await donoAlfa.post('/api/v1/vehicles', { ...VEICULO, model: 'Outro' });
    expect(repetida.status).toBe(409);
    expect(repetida.body.error.code).toBe('CONFLICT');
    // A mensagem nao pode dizer QUAL registro colidiu.
    expect(repetida.body.error.message).not.toContain('ABC1D23');

    // Empresa vizinha com a mesma placa: unicidade e por empresa, e tem de ser.
    const naBeta = await donoBeta.post('/api/v1/vehicles', VEICULO);
    expect(naBeta.status).toBe(201);
    expect(naBeta.body.plate).toBe('ABC1D23');

    const total = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Vehicle" WHERE plate = 'ABC1D23'`,
    );
    expect(Number(total[0]!.n)).toBe(2);
  });

  it('aceita quilometragem que avanca e recusa a que anda para tras', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const criado = await dono.post('/api/v1/vehicles', { ...VEICULO, km: 50_000 });
    const id: string = criado.body.id;

    const avanco = await dono.patch(`/api/v1/vehicles/${id}/km`, { km: 50_420 });
    expect(avanco.status).toBe(200);
    expect(avanco.body.km).toBe(50_420);

    const retrocesso = await dono.patch(`/api/v1/vehicles/${id}/km`, { km: 40_000 });
    expect(retrocesso.status).toBe(409);
    expect(retrocesso.body.error.message).toContain('menor que a registrada');

    const naTabela = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ km: number }>>`SELECT km FROM "Vehicle" WHERE id = ${id}`,
    );
    expect(naTabela[0]!.km).toBe(50_420);
  });

  it('exclusao de veiculo e logica e so o OWNER faz', async () => {
    await criarUsuario(alfa, 'MANAGER', 'gestor.alfa@teste.com.br', { canManageRoutes: true });
    const dono = await autenticar('dono.alfa@teste.com.br');
    const gestor = await autenticar('gestor.alfa@teste.com.br');

    const criado = await dono.post('/api/v1/vehicles', VEICULO);
    const id: string = criado.body.id;

    expect((await gestor.delete(`/api/v1/vehicles/${id}`)).status).toBe(403);

    const res = await dono.delete(`/api/v1/vehicles/${id}`);
    expect(res.status).toBe(204);

    const linha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ deletedAt: Date | null }>>`SELECT "deletedAt" FROM "Vehicle" WHERE id = ${id}`,
    );
    expect(linha).toHaveLength(1);
    expect(linha[0]!.deletedAt).not.toBeNull();
  });
});

describe('motoristas', () => {
  it('cria, le e atualiza o motorista', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const criado = await dono.post('/api/v1/drivers', {
      name: 'Jonas Ribeiro',
      shiftType: 'MORNING',
      dailyRate: 180,
    });
    expect(criado.status).toBe(201);
    expect(criado.body.dailyRate.cents).toBe(18000);
    expect(criado.body.status).toBe('ACTIVE');

    const alterado = await dono.patch(`/api/v1/drivers/${criado.body.id}`, { dailyRate: 200 });
    expect(alterado.status).toBe(200);
    expect(alterado.body.dailyRate.cents).toBe(20000);
  });

  it('arquiva o motorista e arquiva junto o vinculo dele com a empresa', async () => {
    const usuarioMotorista = await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');

    const criado = await dono.post('/api/v1/drivers', {
      name: 'Jonas Ribeiro',
      dailyRate: 180,
      userId: usuarioMotorista.id,
    });
    expect(criado.status).toBe(201);

    const arquivado = await dono.post(`/api/v1/drivers/${criado.body.id}/archive`);
    expect(arquivado.status).toBe(200);
    expect(arquivado.body.status).toBe('ARCHIVED');

    const vinculo = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ status: string; leftAt: Date | null }>>`
        SELECT status, "leftAt" FROM "UserCompany" WHERE "userId" = ${usuarioMotorista.id}`,
    );
    expect(vinculo[0]!.status).toBe('ARCHIVED');
    expect(vinculo[0]!.leftAt).not.toBeNull();

    // Arquivar duas vezes e erro de estado, nao operacao silenciosa.
    const denovo = await dono.post(`/api/v1/drivers/${criado.body.id}/archive`);
    expect(denovo.status).toBe(409);
  });

  it('nao arquiva motorista com cartao de ponto em aberto', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const veiculo = await dono.post('/api/v1/vehicles', VEICULO);
    const motorista = await dono.post('/api/v1/drivers', { name: 'Jonas', dailyRate: 180 });

    await runUnscoped('fixture', () =>
      prisma.timecard.create({
        data: {
          companyId: alfa.id,
          driverId: motorista.body.id,
          vehicleId: veiculo.body.id,
          status: 'IN_PROGRESS',
        },
      }),
    );

    const res = await dono.post(`/api/v1/drivers/${motorista.body.id}/archive`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('cartão(ões) de ponto em aberto');
  });

  it('holerite: o motorista ve o proprio e recebe 404 no de outro', async () => {
    const usuarioMotorista = await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');

    const veiculo = await dono.post('/api/v1/vehicles', VEICULO);
    const meu = await dono.post('/api/v1/drivers', {
      name: 'Jonas Ribeiro',
      dailyRate: 180,
      userId: usuarioMotorista.id,
    });
    const colega = await dono.post('/api/v1/drivers', { name: 'Marcos Colega', dailyRate: 250 });

    // Dois dias trabalhados em marco/2026 e um fretamento no mesmo mes.
    await runUnscoped('fixture', async () => {
      for (const dia of [3, 4]) {
        await prisma.timecard.create({
          data: {
            companyId: alfa.id,
            driverId: meu.body.id,
            vehicleId: veiculo.body.id,
            status: 'COMPLETED',
            date: new Date(Date.UTC(2026, 2, dia)),
          },
        });
      }
      await prisma.charter.create({
        data: {
          companyId: alfa.id,
          title: 'Excursao Serra',
          contractor: 'Escola Aurora',
          priceCents: toCents(4500),
          startDate: new Date(Date.UTC(2026, 2, 10)),
          endDate: new Date(Date.UTC(2026, 2, 11)),
          status: 'COMPLETED',
          vehicleId: veiculo.body.id,
          driverId: meu.body.id,
        },
      });
    });

    const motorista = await autenticar('motorista@teste.com.br');

    const proprio = await motorista.get(`/api/v1/drivers/${meu.body.id}/earnings?month=2026-03`);
    expect(proprio.status).toBe(200);
    expect(proprio.body.workedDays).toBe(2);
    expect(proprio.body.total.cents).toBe(2 * 18000);
    expect(proprio.body.charters).toHaveLength(1);
    // O preco do fretamento e faturamento da EMPRESA: nao pode aparecer no
    // holerite de quem so tem direito a propria remuneracao.
    expect(proprio.body.charters[0]).not.toHaveProperty('price');
    expect(proprio.body.charters[0]).not.toHaveProperty('priceCents');
    expect(JSON.stringify(proprio.body)).not.toContain('4500');
    expect(JSON.stringify(proprio.body)).not.toContain('450000');

    // 404 e nao 403: 403 confirmaria que aquele motorista existe na empresa.
    const doColega = await motorista.get(`/api/v1/drivers/${colega.body.id}/earnings?month=2026-03`);
    expect(doColega.status).toBe(404);
    expect(JSON.stringify(doColega.body)).not.toContain('Marcos');
  });

  it('motorista nao lista o cadastro de motoristas da empresa', async () => {
    await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');
    await dono.post('/api/v1/drivers', { name: 'Marcos Colega', dailyRate: 250 });

    const motorista = await autenticar('motorista@teste.com.br');
    const res = await motorista.get('/api/v1/drivers');
    expect(res.status).toBe(403);
  });

  it('barra o cadastro de motorista acima do teto do plano', async () => {
    const apertada = await criarEmpresa('Empresa Apertada', '55666777000188', {
      limites: { maxDrivers: 1 },
    });
    await criarUsuario(apertada, 'OWNER', 'dono.apertada@teste.com.br');
    const dono = await autenticar('dono.apertada@teste.com.br');

    expect((await dono.post('/api/v1/drivers', { name: 'Primeiro', dailyRate: 100 })).status).toBe(201);
    const segundo = await dono.post('/api/v1/drivers', { name: 'Segundo', dailyRate: 100 });
    expect(segundo.status).toBe(402);
    expect(segundo.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});
