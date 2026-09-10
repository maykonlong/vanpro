import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { criarEmpresa, criarUsuario, autenticar, type Empresa, type Usuario } from '../helpers/factory';

/**
 * Cartao de ponto.
 *
 * Documento trabalhista: a jornada e reconstruida pela sequencia de batidas,
 * entao a maquina de estados e o teste. Cada transicao invalida tem de dizer em
 * que estado a jornada esta — o app precisa mostrar o botao certo em vez de
 * insistir no errado — e nenhum motorista pode bater o ponto de outro.
 */

let alfa: Empresa;
let usuarioMotorista: Usuario;
let driverId: string;
let vehicleId: string;
let outroVehicleId: string;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  usuarioMotorista = await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');

  await runUnscoped('fixture', async () => {
    const driver = await prisma.driver.create({
      data: { companyId: alfa.id, name: 'Jonas Ribeiro', userId: usuarioMotorista.id, dailyRateCents: 18000 },
    });
    const vehicle = await prisma.vehicle.create({
      data: { companyId: alfa.id, plate: 'ABC1D23', model: 'Sprinter', capacity: 20, km: 10_000 },
    });
    const outro = await prisma.vehicle.create({
      data: { companyId: alfa.id, plate: 'XYZ9K88', model: 'Master', capacity: 16 },
    });
    driverId = driver.id;
    vehicleId = vehicle.id;
    outroVehicleId = outro.id;
  });
});

describe('ciclo completo', () => {
  it('percorre CLOCK_IN, BREAK_START, BREAK_END e CLOCK_OUT', async () => {
    const motorista = await autenticar('motorista@teste.com.br');

    const entrada = await motorista.post('/api/v1/timecards/punch', {
      type: 'CLOCK_IN',
      vehicleId,
      km: 10_000,
    });
    expect(entrada.status).toBe(201);
    expect(entrada.body.status).toBe('IN_PROGRESS');
    expect(entrada.body.driverId).toBe(driverId);
    expect(entrada.body.punches).toHaveLength(1);
    const cartaoId: string = entrada.body.id;

    const pausa = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId });
    expect(pausa.status).toBe(201);
    expect(pausa.body.id).toBe(cartaoId);
    expect(pausa.body.status).toBe('IN_PROGRESS');

    const retorno = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_END', vehicleId });
    expect(retorno.status).toBe(201);

    const saida = await motorista.post('/api/v1/timecards/punch', {
      type: 'CLOCK_OUT',
      vehicleId,
      km: 10_180,
    });
    expect(saida.status).toBe(201);
    expect(saida.body.status).toBe('COMPLETED');
    expect(saida.body.punches.map((p: { type: string }) => p.type)).toEqual([
      'CLOCK_IN',
      'BREAK_START',
      'BREAK_END',
      'CLOCK_OUT',
    ]);

    // As batidas sao append-only: nenhuma foi reescrita no caminho.
    const gravadas = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ type: string; km: number | null }>>`
        SELECT type, km FROM "Punch" WHERE "timecardId" = ${cartaoId} ORDER BY "createdAt" ASC`,
    );
    expect(gravadas).toHaveLength(4);
    expect(gravadas[0]!.km).toBe(10_000);
    expect(gravadas[3]!.km).toBe(10_180);

    // Turno encerrado libera uma nova entrada.
    const novaEntrada = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });
    expect(novaEntrada.status).toBe(201);
    expect(novaEntrada.body.id).not.toBe(cartaoId);
  });
});

describe('transicoes invalidas', () => {
  it('CLOCK_IN com turno ja aberto devolve 409 informando o cartao em andamento', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    const primeiro = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });
    expect(primeiro.status).toBe(201);

    const segundo = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });
    expect(segundo.status).toBe(409);
    expect(segundo.body.error.message).toContain(primeiro.body.id);
    expect(segundo.body.error.message).toContain('turno em andamento');
  });

  it('BREAK_START, BREAK_END e CLOCK_OUT sem turno aberto devolvem 409', async () => {
    const motorista = await autenticar('motorista@teste.com.br');

    for (const type of ['BREAK_START', 'BREAK_END', 'CLOCK_OUT']) {
      const res = await motorista.post('/api/v1/timecards/punch', { type, vehicleId });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('Não há turno em andamento');
    }

    const nenhum = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Timecard"`,
    );
    expect(Number(nenhum[0]!.n)).toBe(0);
  });

  it('BREAK_END sem pausa aberta e BREAK_START com pausa aberta devolvem 409', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });

    const semPausa = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_END', vehicleId });
    expect(semPausa.status).toBe(409);
    expect(semPausa.body.error.message).toContain('Não há pausa em andamento');

    expect((await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId })).status).toBe(201);

    const pausaDupla = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId });
    expect(pausaDupla.status).toBe(409);
    expect(pausaDupla.body.error.message).toContain('pausa em andamento');
  });

  it('CLOCK_OUT com pausa aberta devolve 409 e mantem o turno em andamento', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    const cartao = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });
    await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId });

    const saida = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_OUT', vehicleId });
    expect(saida.status).toBe(409);
    expect(saida.body.error.message).toContain('Encerre a pausa');

    const estado = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Timecard" WHERE id = ${cartao.body.id}`,
    );
    expect(estado[0]!.status).toBe('IN_PROGRESS');
  });

  it('trocar de veiculo no meio da jornada devolve 409', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });

    const res = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId: outroVehicleId });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain(vehicleId);
  });

  it('quilometragem so e aceita na entrada e na saida', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId, km: 10_000 });

    const res = await motorista.post('/api/v1/timecards/punch', { type: 'BREAK_START', vehicleId, km: 10_050 });
    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d: { campo: string }) => d.campo === 'body.km')).toBe(true);
  });

  it('recusa saida com quilometragem menor que a da entrada', async () => {
    const motorista = await autenticar('motorista@teste.com.br');
    const cartao = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId, km: 10_000 });

    const saida = await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_OUT', vehicleId, km: 9_500 });
    expect(saida.status).toBe(409);
    expect(saida.body.error.message).toContain('menor que a da entrada');

    const estado = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM "Timecard" WHERE id = ${cartao.body.id}`,
    );
    expect(estado[0]!.status).toBe('IN_PROGRESS');
    const batidas = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Punch" WHERE "timecardId" = ${cartao.body.id}`,
    );
    expect(Number(batidas[0]!.n)).toBe(1);
  });
});

describe('quem bate o ponto', () => {
  it('o driverId do corpo nao permite ao motorista bater o ponto de outro', async () => {
    const colegaId = await runUnscoped('fixture', async () => {
      const d = await prisma.driver.create({ data: { companyId: alfa.id, name: 'Marcos Colega', dailyRateCents: 25000 } });
      return d.id;
    });

    const motorista = await autenticar('motorista@teste.com.br');
    const res = await motorista.post('/api/v1/timecards/punch', {
      type: 'CLOCK_IN',
      vehicleId,
      driverId: colegaId,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('próprio ponto');

    const doColega = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Timecard" WHERE "driverId" = ${colegaId}`,
    );
    expect(Number(doColega[0]!.n)).toBe(0);
  });

  it('a gestao registra ponto por outro e a batida sai marcada como manual', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.post('/api/v1/timecards/punch', {
      type: 'CLOCK_IN',
      vehicleId,
      driverId,
    });
    expect(res.status).toBe(201);
    expect(res.body.driverId).toBe(driverId);

    const trilha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ description: string }>>`
        SELECT description FROM "AuditLog" WHERE action = 'TIMECARD_PUNCH' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(trilha[0]!.description).toContain('REGISTRO MANUAL');
  });

  it('usuario sem cadastro de motorista ativo nao bate ponto', async () => {
    await criarUsuario(alfa, 'DRIVER', 'sem.cadastro@teste.com.br');
    const avulso = await autenticar('sem.cadastro@teste.com.br');

    const res = await avulso.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('não está vinculado');
  });

  it('motorista so enxerga a propria folha de ponto', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const motorista = await autenticar('motorista@teste.com.br');

    const colegaId = await runUnscoped('fixture', async () => {
      const d = await prisma.driver.create({ data: { companyId: alfa.id, name: 'Marcos Colega', dailyRateCents: 25000 } });
      await prisma.timecard.create({
        data: { companyId: alfa.id, driverId: d.id, vehicleId, status: 'COMPLETED' },
      });
      return d.id;
    });

    await motorista.post('/api/v1/timecards/punch', { type: 'CLOCK_IN', vehicleId });

    const doDono = await dono.get('/api/v1/timecards');
    expect(doDono.body.meta.total).toBe(2);

    const doMotorista = await motorista.get('/api/v1/timecards');
    expect(doMotorista.body.meta.total).toBe(1);
    expect(doMotorista.body.items[0].driverId).toBe(driverId);

    // Ate filtrando explicitamente pelo colega, o escopo do motorista prevalece.
    const forcado = await motorista.get(`/api/v1/timecards?driverId=${colegaId}`);
    expect(forcado.body.items).toHaveLength(1);
    expect(forcado.body.items[0].driverId).toBe(driverId);
  });
});
