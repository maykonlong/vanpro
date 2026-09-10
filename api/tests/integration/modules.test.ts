import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { toCents } from '../../src/lib/money';
import {
  criarEmpresa,
  criarPlano,
  criarUsuario,
  autenticar,
  Cliente,
  SENHA,
  type Empresa,
  type Usuario,
} from '../helpers/factory';

/**
 * Fretamento, CRM, equipe e cadastro self-service.
 *
 * Sao os modulos que sobraram fora dos arquivos por area, e nao ficam de fora
 * por serem menores: e aqui que moram o chat da equipe, a nota sigilosa sobre a
 * familia e o convite que cria conta — tres lugares onde um vazamento entre
 * empresas doi tanto quanto no DRE.
 */

let alfa: Empresa;
let beta: Empresa;
let mae: Usuario;
let alunoId: string;

const PERIODO = {
  startDate: '2026-04-10T08:00:00.000Z',
  endDate: '2026-04-12T18:00:00.000Z',
};

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  beta = await criarEmpresa('Empresa Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
  mae = await criarUsuario(alfa, 'PARENT', 'mae@teste.com.br');

  alunoId = await runUnscoped('fixture', async () => {
    const aluno = await prisma.student.create({
      data: {
        companyId: alfa.id,
        name: 'Beatriz Nogueira',
        school: 'Colegio Sao Bento',
        shift: 'MORNING',
        monthlyFeeCents: toCents(480.5),
        parentId: mae.id,
      },
    });
    return aluno.id;
  });
});

describe('fretamento', () => {
  it('cria, lista e nao mostra o contrato da empresa vizinha', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    const criado = await donoAlfa.post('/api/v1/charters', {
      title: 'Excursao Serra',
      contractor: 'Escola Aurora',
      price: 4500,
      ...PERIODO,
    });
    expect(criado.status).toBe(201);
    expect(criado.body.price.cents).toBe(450_000);
    expect(criado.body.status).toBe('PENDING');
    expect(criado.body.vehicleId).toBeNull();

    expect((await donoAlfa.get('/api/v1/charters')).body.meta.total).toBe(1);
    expect((await donoBeta.get('/api/v1/charters')).body.meta.total).toBe(0);
    expect((await donoBeta.get(`/api/v1/charters/${criado.body.id}`)).status).toBe(404);
  });

  it('recusa periodo invertido e periodo longo demais', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const invertido = await dono.post('/api/v1/charters', {
      title: 'Invertido',
      contractor: 'Escola',
      price: 100,
      startDate: '2026-04-12T08:00:00.000Z',
      endDate: '2026-04-10T08:00:00.000Z',
    });
    expect(invertido.status).toBe(422);

    const longo = await dono.post('/api/v1/charters', {
      title: 'Eterno',
      contractor: 'Escola',
      price: 100,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
    });
    expect(longo.status).toBe(422);
  });

  it('atribuir veiculo ja escalado no mesmo intervalo devolve 409', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const veiculo = await dono.post('/api/v1/vehicles', { plate: 'ABC1D23', capacity: 20 });
    const motorista = await dono.post('/api/v1/drivers', { name: 'Jonas', dailyRate: 180 });

    // Contrato ja ocupando a agenda no mesmo intervalo.
    await runUnscoped('fixture', () =>
      prisma.charter.create({
        data: {
          companyId: alfa.id,
          title: 'Contrato Anterior',
          contractor: 'Outra Escola',
          priceCents: toCents(1000),
          startDate: new Date(PERIODO.startDate),
          endDate: new Date(PERIODO.endDate),
          status: 'IN_PROGRESS',
          vehicleId: veiculo.body.id,
          driverId: motorista.body.id,
        },
      }),
    );

    const novo = await dono.post('/api/v1/charters', {
      title: 'Excursao Serra',
      contractor: 'Escola Aurora',
      price: 4500,
      ...PERIODO,
    });

    const res = await dono.post(`/api/v1/charters/${novo.body.id}/assign`, {
      vehicleId: veiculo.body.id,
      driverId: motorista.body.id,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Contrato Anterior');

    const semAtribuicao = await dono.get(`/api/v1/charters/${novo.body.id}`);
    expect(semAtribuicao.body.vehicleId).toBeNull();
  });

  it('recusa atribuicao de veiculo de outra empresa', async () => {
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const veiculoBeta = await donoBeta.post('/api/v1/vehicles', { plate: 'ZZZ9Z99', capacity: 12 });

    const dono = await autenticar('dono.alfa@teste.com.br');
    const motorista = await dono.post('/api/v1/drivers', { name: 'Jonas', dailyRate: 180 });
    const charter = await dono.post('/api/v1/charters', {
      title: 'Excursao Serra',
      contractor: 'Escola Aurora',
      price: 4500,
      ...PERIODO,
    });

    const res = await dono.post(`/api/v1/charters/${charter.body.id}/assign`, {
      vehicleId: veiculoBeta.body.id,
      driverId: motorista.body.id,
    });
    expect(res.status).toBe(404);
  });

  it('recusa transicao de estado fora do mapa e diz quais sao possiveis', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const charter = await dono.post('/api/v1/charters', {
      title: 'Excursao Serra',
      contractor: 'Escola Aurora',
      price: 4500,
      ...PERIODO,
    });

    // PENDING so vai para IN_PROGRESS ou CANCELED.
    const res = await dono.post(`/api/v1/charters/${charter.body.id}/status`, { status: 'COMPLETED' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('IN_PROGRESS');
  });

  it('avanca o estado do contrato pelo caminho permitido', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const charter = await dono.post('/api/v1/charters', {
      title: 'Excursao Serra',
      contractor: 'Escola Aurora',
      price: 4500,
      ...PERIODO,
    });

    const res = await dono.post(`/api/v1/charters/${charter.body.id}/status`, { status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('so exclui contrato ainda pendente', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const emAndamento = await runUnscoped('fixture', () =>
      prisma.charter.create({
        data: {
          companyId: alfa.id,
          title: 'Ja rodando',
          contractor: 'Escola',
          priceCents: toCents(1000),
          startDate: new Date(PERIODO.startDate),
          endDate: new Date(PERIODO.endDate),
          status: 'IN_PROGRESS',
        },
      }),
    );

    const recusado = await dono.delete(`/api/v1/charters/${emAndamento.id}`);
    expect(recusado.status).toBe(409);

    const pendente = await dono.post('/api/v1/charters', {
      title: 'Ainda Pendente',
      contractor: 'Escola',
      price: 1000,
      ...PERIODO,
    });
    expect((await dono.delete(`/api/v1/charters/${pendente.body.id}`)).status).toBe(204);
  });

  it('motorista so ve os fretamentos atribuidos a ele', async () => {
    const usuarioMotorista = await criarUsuario(alfa, 'DRIVER', 'motorista@teste.com.br');
    const dono = await autenticar('dono.alfa@teste.com.br');

    const meuId = await runUnscoped('fixture', async () => {
      const d = await prisma.driver.create({
        data: { companyId: alfa.id, name: 'Jonas', userId: usuarioMotorista.id, dailyRateCents: 18_000 },
      });
      await prisma.charter.create({
        data: {
          companyId: alfa.id,
          title: 'Meu Contrato',
          contractor: 'Escola',
          priceCents: toCents(1000),
          startDate: new Date(PERIODO.startDate),
          endDate: new Date(PERIODO.endDate),
          driverId: d.id,
        },
      });
      await prisma.charter.create({
        data: {
          companyId: alfa.id,
          title: 'Contrato de Outro',
          contractor: 'Escola',
          priceCents: toCents(1000),
          startDate: new Date(PERIODO.startDate),
          endDate: new Date(PERIODO.endDate),
        },
      });
      return d.id;
    });

    expect((await dono.get('/api/v1/charters')).body.meta.total).toBe(2);

    const motorista = await autenticar('motorista@teste.com.br');
    const lista = await motorista.get('/api/v1/charters');
    expect(lista.body.items).toHaveLength(1);
    expect(lista.body.items[0].title).toBe('Meu Contrato');
    expect(lista.body.items[0].driverId).toBe(meuId);
  });
});

describe('CRM', () => {
  it('nota sigilosa some para o responsavel e aparece para a equipe', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const sigilosa = await dono.post(`/api/v1/crm/students/${alunoId}/notes`, {
      content: 'Conversa interna sobre atraso de pagamento',
      isSecret: true,
    });
    expect(sigilosa.status).toBe(201);
    expect(sigilosa.body.authorId).toBeTruthy();

    const aberta = await dono.post(`/api/v1/crm/students/${alunoId}/notes`, {
      content: 'Levar cadeirinha na quarta',
      isSecret: false,
    });
    expect(aberta.status).toBe(201);

    const daEquipe = await dono.get(`/api/v1/crm/students/${alunoId}/notes`);
    expect(daEquipe.body.meta.total).toBe(2);

    const cliente = await autenticar('mae@teste.com.br');
    const doResponsavel = await cliente.get(`/api/v1/crm/students/${alunoId}/notes`);
    expect(doResponsavel.status).toBe(200);
    expect(doResponsavel.body.meta.total).toBe(1);
    expect(JSON.stringify(doResponsavel.body)).not.toContain('atraso de pagamento');
  });

  it('responsavel nao le notas de crianca de outra familia', async () => {
    const outroId = await runUnscoped('fixture', async () => {
      const s = await prisma.student.create({
        data: { companyId: alfa.id, name: 'Outra Crianca', school: 'E', shift: 'FULL', monthlyFeeCents: 0 },
      });
      return s.id;
    });

    const cliente = await autenticar('mae@teste.com.br');
    expect((await cliente.get(`/api/v1/crm/students/${outroId}/notes`)).status).toBe(404);
  });

  it('o autor da nota vem da sessao, nao do corpo', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const donoId = (await dono.get('/api/v1/auth/me')).body.id;

    const res = await dono.post(`/api/v1/crm/students/${alunoId}/notes`, {
      content: 'Nota assinada',
      isSecret: false,
      authorId: mae.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.authorId).toBe(donoId);
    expect(res.body.authorId).not.toBe(mae.id);
  });

  it('incidente e chat ficam dentro da empresa que os criou', async () => {
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const donoBeta = await autenticar('dono.beta@teste.com.br');

    const incidente = await donoAlfa.post('/api/v1/crm/incidents/broadcast', {
      title: 'Via marginal interditada',
      description: 'Desvio pela avenida central ate as 9h',
      severity: 'HIGH',
    });
    expect(incidente.status).toBe(201);
    expect(incidente.body.severity).toBe('HIGH');

    const mensagem = await donoAlfa.post('/api/v1/crm/chat/messages', { content: 'Bom dia, equipe' });
    expect(mensagem.status).toBe(201);
    // O nome do remetente sai do banco: aceitar o do corpo permitiria assinar
    // como o dono da empresa.
    expect(mensagem.body.senderName).toBe('Usuario OWNER');

    expect((await donoBeta.get('/api/v1/crm/incidents')).body.meta.total).toBe(0);
    expect((await donoBeta.get('/api/v1/crm/chat/messages')).body.meta.total).toBe(0);
    expect((await donoAlfa.get('/api/v1/crm/incidents')).body.meta.total).toBe(1);
    expect((await donoAlfa.get('/api/v1/crm/chat/messages')).body.meta.total).toBe(1);
  });

  it('responsavel nao alcanca incidente nem chat da equipe', async () => {
    const cliente = await autenticar('mae@teste.com.br');
    expect((await cliente.get('/api/v1/crm/incidents')).status).toBe(403);
    expect((await cliente.get('/api/v1/crm/chat/messages')).status).toBe(403);
  });
});

describe('empresa e equipe', () => {
  it('GET /company/me traz o uso do plano da propria empresa', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    await dono.post('/api/v1/vehicles', { plate: 'ABC1D23', capacity: 20 });

    const res = await dono.get('/api/v1/company/me');
    expect(res.status).toBe(200);
    expect(res.body.company.id).toBe(alfa.id);
    expect(res.body.plan.usage.vehicles.used).toBe(1);
    expect(res.body.plan.usage.students.used).toBe(1);
    expect(res.body.plan.usage.drivers.used).toBe(0);
  });

  it('convite cria o vinculo como INVITED e guarda apenas o hash do token', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.post('/api/v1/company/team/invite', {
      name: 'Novo Monitor',
      email: 'monitor.novo@teste.com.br',
      role: 'ASSISTANT',
      contractType: 'FULL_TIME',
      permissions: { canManageFinance: false, canManageHR: false, canManageRoutes: false },
    });

    expect(res.status).toBe(201);
    expect(res.body.member.status).toBe('INVITED');
    expect(res.body.emailSent).toBe(false);
    expect(res.body.inviteLink).toContain('token=');

    const token = new URL(res.body.inviteLink).searchParams.get('token')!;
    const guardado = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ inviteTokenHash: string | null }>>`
        SELECT "inviteTokenHash" FROM "UserCompany" WHERE id = ${res.body.member.id}`,
    );
    // O token cru nunca vai para a tabela: dump de banco nao pode virar molho
    // de convites validos.
    expect(guardado[0]!.inviteTokenHash).not.toBe(token);
    expect(guardado[0]!.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/);

    const equipe = await dono.get('/api/v1/company/team?status=INVITED');
    expect(equipe.status).toBe(200);
    expect(equipe.body.items).toHaveLength(1);
    expect(equipe.body.items[0].email).toBe('monitor.novo@teste.com.br');
  });

  it('convidar quem ja e da equipe devolve 409', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/company/team/invite', {
      name: 'Mae Duplicada',
      email: 'mae@teste.com.br',
      role: 'PARENT',
      contractType: 'FULL_TIME',
      permissions: { canManageFinance: false, canManageHR: false, canManageRoutes: false },
    });
    expect(res.status).toBe(409);
  });

  it('a listagem de equipe nao mistura pessoas de outra empresa', async () => {
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const donoAlfa = await autenticar('dono.alfa@teste.com.br');

    const daAlfa = await donoAlfa.get('/api/v1/company/team');
    const daBeta = await donoBeta.get('/api/v1/company/team');

    expect(daAlfa.body.meta.total).toBe(2); // dono + mae
    expect(daBeta.body.meta.total).toBe(1);
    expect(JSON.stringify(daBeta.body)).not.toContain('mae@teste.com.br');
  });
});

describe('cadastro self-service', () => {
  beforeEach(async () => {
    // O registro exige o plano FREE provisionado: ausencia dele e falha de
    // ambiente, e o controller devolve 500 de proposito em vez de inventar um.
    await criarPlano('FREE', { maxVehicles: 2, maxDrivers: 2, maxStudents: 10 });
  });

  it('cria empresa em trial, o OWNER e a sessao numa unica chamada', async () => {
    const c = new Cliente();
    const res = await c.post('/api/v1/register', {
      companyName: 'Van do Bairro',
      document: '11144477735',
      ownerName: 'Carla Souza',
      ownerEmail: 'carla@vandobairro.com.br',
      ownerPassword: SENHA,
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.trialEndsAt).toBeTruthy();
    expect(res.body).not.toHaveProperty('accessToken');

    // A sessao ja veio: a proxima chamada autenticada funciona sem login.
    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.company.tenantStatus).toBe('TRIAL');

    const vinculo = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ status: string; canManageFinance: boolean }>>`
        SELECT status, "canManageFinance" FROM "UserCompany" WHERE "userId" = ${res.body.user.id}`,
    );
    expect(vinculo[0]!.status).toBe('ACTIVE');
    expect(vinculo[0]!.canManageFinance).toBe(true);
  });

  it('e-mail e CNPJ ja usados devolvem a MESMA mensagem, sem dizer qual colidiu', async () => {
    const primeiro = await new Cliente().post('/api/v1/register', {
      companyName: 'Van do Bairro',
      document: '11144477735',
      ownerName: 'Carla Souza',
      ownerEmail: 'carla@vandobairro.com.br',
      ownerPassword: SENHA,
    });
    expect(primeiro.status).toBe(201);

    const mesmoEmail = await new Cliente().post('/api/v1/register', {
      companyName: 'Outra Van',
      document: '98765432000198',
      ownerName: 'Outro Dono',
      ownerEmail: 'carla@vandobairro.com.br',
      ownerPassword: SENHA,
    });
    const mesmoDocumento = await new Cliente().post('/api/v1/register', {
      companyName: 'Outra Van',
      document: '11144477735',
      ownerName: 'Outro Dono',
      ownerEmail: 'outro@vandobairro.com.br',
      ownerPassword: SENHA,
    });

    expect(mesmoEmail.status).toBe(409);
    expect(mesmoDocumento.status).toBe(409);
    // Mensagem identica: distinguir os dois casos transforma o cadastro publico
    // num verificador de e-mails e de CNPJs cadastrados.
    expect(mesmoEmail.body.error.message).toBe(mesmoDocumento.body.error.message);
  });

  it('recusa documento invalido e senha fraca', async () => {
    const documentoInvalido = await new Cliente().post('/api/v1/register', {
      companyName: 'Van do Bairro',
      document: '11111111111',
      ownerName: 'Carla Souza',
      ownerEmail: 'carla@vandobairro.com.br',
      ownerPassword: SENHA,
    });
    expect(documentoInvalido.status).toBe(422);

    const senhaFraca = await new Cliente().post('/api/v1/register', {
      companyName: 'Van do Bairro',
      document: '11144477735',
      ownerName: 'Carla Souza',
      ownerEmail: 'carla@vandobairro.com.br',
      ownerPassword: 'senha123',
    });
    expect(senhaFraca.status).toBe(422);

    const nenhuma = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Company" WHERE document = '11144477735'`,
    );
    expect(Number(nenhuma[0]!.n)).toBe(0);
  });
});
