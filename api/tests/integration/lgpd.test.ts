import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { verifyChain } from '../../src/lib/audit';
import { toCents } from '../../src/lib/money';
import { criarEmpresa, criarUsuario, autenticar, type Empresa, type Usuario } from '../helpers/factory';

/**
 * LGPD.
 *
 * Direito sem rota e politica de privacidade, nao software. Cada teste aqui
 * cobra um artigo: portabilidade que entrega dado de verdade, consentimento que
 * grava a data da manifestacao, eliminacao que passa pelo controlador e para
 * diante de obrigacao fiscal, e uma trilha que se sabe verificar — inclusive
 * quando alguem adultera uma linha por fora do sistema.
 */

let alfa: Empresa;
let mae: Usuario;
let filhoId: string;
let deOutraFamiliaId: string;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  mae = await criarUsuario(alfa, 'PARENT', 'mae@teste.com.br');

  await runUnscoped('fixture', async () => {
    const filho = await prisma.student.create({
      data: {
        companyId: alfa.id,
        name: 'Beatriz Nogueira',
        school: 'Colegio Sao Bento',
        shift: 'MORNING',
        monthlyFeeCents: toCents(480.5),
        address: 'Rua Haddock Lobo, 400 - apto 71-B',
        parentId: mae.id,
        lgpdConsent: true,
        imageConsent: false,
      },
    });
    const outro = await prisma.student.create({
      data: {
        companyId: alfa.id,
        name: 'Crianca de Outra Familia',
        school: 'Colegio Sao Bento',
        shift: 'MORNING',
        monthlyFeeCents: toCents(400),
      },
    });
    filhoId = filho.id;
    deOutraFamiliaId = outro.id;
  });
});

describe('portabilidade', () => {
  it('PARENT exporta apenas os proprios dependentes, com manifesto e base legal', async () => {
    const cliente = await autenticar('mae@teste.com.br');
    const res = await cliente.get('/api/v1/privacy/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');

    const payload = JSON.parse(res.text);
    expect(payload.manifesto.escopo).toBe('DEPENDENTES_DO_RESPONSAVEL');
    expect(payload.manifesto.baseLegal).toContain('Art. 18');
    expect(payload.manifesto.totalRegistros).toBe(1);
    expect(payload.alunos).toHaveLength(1);
    expect(payload.alunos[0].name).toBe('Beatriz Nogueira');
    // Exportacao serve para levar o dado embora: precisa vir decifrado.
    expect(payload.alunos[0].address).toBe('Rua Haddock Lobo, 400 - apto 71-B');
    expect(JSON.stringify(payload)).not.toContain('Crianca de Outra Familia');

    const trilha = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "AuditLog" WHERE action = 'LGPD_DATA_EXPORT'`,
    );
    expect(Number(trilha[0]!.n)).toBe(1);
  });

  it('OWNER exporta a empresa inteira, paginado', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get('/api/v1/privacy/export?perPage=1&page=2');

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.text);
    expect(payload.manifesto.escopo).toBe('EMPRESA');
    expect(payload.manifesto.totalRegistros).toBe(2);
    expect(payload.manifesto.parte).toBe(2);
    expect(payload.manifesto.totalPartes).toBe(2);
    expect(payload.alunos).toHaveLength(1);
  });

  it('/my-data confirma o tratamento sem devolver segredo nenhum', async () => {
    const cliente = await autenticar('mae@teste.com.br');
    const res = await cliente.get('/api/v1/privacy/my-data');

    expect(res.status).toBe(200);
    expect(res.body.usuario.email).toBe('mae@teste.com.br');
    expect(res.body.usuario.sessions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.usuario).not.toHaveProperty('password');
    expect(res.body.usuario).not.toHaveProperty('twoFactorSecret');
  });
});

describe('consentimento', () => {
  it('o responsavel autoriza uso de imagem e a data da manifestacao fica gravada', async () => {
    const cliente = await autenticar('mae@teste.com.br');

    const antes = await cliente.get('/api/v1/privacy/consents');
    expect(antes.status).toBe(200);
    expect(antes.body.items).toHaveLength(1);
    expect(antes.body.items[0].imageConsent).toBe(false);

    const res = await cliente.post('/api/v1/privacy/consents', {
      studentId: filhoId,
      imageConsent: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.imageConsent).toBe(true);
    expect(res.body.consentDate).not.toBeNull();

    const naTabela = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ imageConsent: boolean; consentDate: Date | null }>>`
        SELECT "imageConsent", "consentDate" FROM "Student" WHERE id = ${filhoId}`,
    );
    expect(naTabela[0]!.imageConsent).toBe(true);
    expect(naTabela[0]!.consentDate).not.toBeNull();
  });

  it('a revogacao tambem atualiza a data — e ela que prova quando o uso cessou', async () => {
    const cliente = await autenticar('mae@teste.com.br');

    await cliente.post('/api/v1/privacy/consents', { studentId: filhoId, imageConsent: true });
    const revoga = await cliente.post('/api/v1/privacy/consents', {
      studentId: filhoId,
      lgpdConsent: false,
      imageConsent: false,
    });

    expect(revoga.status).toBe(200);
    expect(revoga.body.lgpdConsent).toBe(false);
    expect(revoga.body.imageConsent).toBe(false);
    expect(new Date(revoga.body.consentDate).getTime()).toBeGreaterThan(0);
  });

  it('responsavel nao mexe no consentimento de crianca de outra familia', async () => {
    const cliente = await autenticar('mae@teste.com.br');
    const res = await cliente.post('/api/v1/privacy/consents', {
      studentId: deOutraFamiliaId,
      imageConsent: true,
    });

    // 404 e nao 403: confirmar a existencia do cadastro de uma crianca para quem
    // so tinha um palpite de id ja e vazamento.
    expect(res.status).toBe(404);

    const intacto = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ imageConsent: boolean }>>`
        SELECT "imageConsent" FROM "Student" WHERE id = ${deOutraFamiliaId}`,
    );
    expect(intacto[0]!.imageConsent).toBe(false);
  });
});

describe('eliminacao', () => {
  it('o pedido entra na fila do controlador e nao apaga nada sozinho', async () => {
    const cliente = await autenticar('mae@teste.com.br');
    const res = await cliente.post('/api/v1/privacy/forget-me', { studentId: filhoId });

    expect(res.status).toBe(202);
    expect(res.body.student.deleteRequestStatus).toBe('PENDING_APPROVAL');

    const naTabela = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ deleteRequestStatus: string | null; deletedAt: Date | null }>>`
        SELECT "deleteRequestStatus", "deletedAt" FROM "Student" WHERE id = ${filhoId}`,
    );
    expect(naTabela[0]!.deleteRequestStatus).toBe('PENDING_APPROVAL');
    expect(naTabela[0]!.deletedAt).toBeNull();

    const dono = await autenticar('dono.alfa@teste.com.br');
    const fila = await dono.get('/api/v1/privacy/deletion-requests');
    expect(fila.status).toBe(200);
    expect(fila.body.items).toHaveLength(1);
    expect(fila.body.items[0].id).toBe(filhoId);
  });

  it('a aprovacao anonimiza de fato: nome e endereco somem, o historico fica', async () => {
    await runUnscoped('fixture', () =>
      prisma.$executeRaw`UPDATE "Student" SET "deleteRequestStatus" = 'PENDING_APPROVAL' WHERE id = ${filhoId}`,
    );

    await runUnscoped('fixture', () =>
      prisma.invoice.create({
        data: {
          companyId: alfa.id,
          studentId: filhoId,
          amountCents: toCents(480.5),
          status: 'RECEIVED',
          dueDate: new Date(Date.UTC(2026, 1, 5)),
        },
      }),
    );

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post(`/api/v1/privacy/deletion-requests/${filhoId}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.deleteRequestStatus).toBe('DELETED');
    expect(res.body.deletedAt).not.toBeNull();

    const anonimizado = await runUnscoped('check', () =>
      prisma.student.findFirst({
        where: { id: filhoId, includeDeleted: true },
        select: { name: true, address: true, dateOfBirth: true, parentId: true, latitude: true },
      }),
    );
    expect(anonimizado!.name).toContain('ANONIMIZADO');
    expect(anonimizado!.name).not.toContain('Beatriz');
    expect(anonimizado!.address).toContain('ANONIMIZADO');
    expect(anonimizado!.address).not.toContain('Haddock');
    expect(anonimizado!.dateOfBirth).toBeNull();
    expect(anonimizado!.parentId).toBeNull();

    // A fatura ja emitida continua existindo: apagar a linha derrubaria o
    // historico financeiro que a empresa e obrigada a guardar.
    const faturas = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Invoice" WHERE "studentId" = ${filhoId}`,
    );
    expect(Number(faturas[0]!.n)).toBe(1);
  });

  it('recusa a aprovacao enquanto houver fatura em aberto', async () => {
    // O pedido entra por fixture, e nao pela rota: quem esta sob teste aqui e a
    // REGRA DE APROVACAO. O caminho do /forget-me tem teste proprio logo acima,
    // e amarrar um ao outro faria uma falha la esconder a cobertura daqui.
    await runUnscoped('fixture', () =>
      prisma.$executeRaw`UPDATE "Student" SET "deleteRequestStatus" = 'PENDING_APPROVAL' WHERE id = ${filhoId}`,
    );

    await runUnscoped('fixture', () =>
      prisma.invoice.create({
        data: {
          companyId: alfa.id,
          studentId: filhoId,
          amountCents: toCents(480.5),
          status: 'PENDING',
          dueDate: new Date(Date.UTC(2026, 2, 5)),
        },
      }),
    );

    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post(`/api/v1/privacy/deletion-requests/${filhoId}/approve`);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Art. 16');

    const intacto = await runUnscoped('check', () =>
      prisma.student.findFirst({ where: { id: filhoId }, select: { name: true, deleteRequestStatus: true } }),
    );
    expect(intacto!.name).toBe('Beatriz Nogueira');
    expect(intacto!.deleteRequestStatus).toBe('PENDING_APPROVAL');
  });

  it('aprovar sem pedido pendente e conflito, nao eliminacao silenciosa', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post(`/api/v1/privacy/deletion-requests/${filhoId}/approve`);
    expect(res.status).toBe(409);
  });
});

describe('trilha de auditoria', () => {
  it('/audit-trail devolve a cadeia intacta depois de varias escritas', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    for (const nome of ['Primeiro', 'Segundo', 'Terceiro']) {
      await dono.post('/api/v1/students', { name: nome, school: 'Escola', shift: 'FULL', monthlyFee: 100 });
    }

    const res = await dono.get('/api/v1/privacy/audit-trail');
    expect(res.status).toBe(200);
    expect(res.body.chainIntegrity.ok).toBe(true);
    expect(res.body.chainIntegrity.checked).toBeGreaterThanOrEqual(3);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    // A trilha nao expoe o hash: quem consulta precisa do veredito, nao do meio
    // de forjar o proximo elo.
    expect(res.body.items[0]).not.toHaveProperty('hash');
  });

  it('adulterar uma linha de AuditLog no banco faz verifyChain acusar a quebra', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    for (const nome of ['Primeiro', 'Segundo', 'Terceiro']) {
      await dono.post('/api/v1/students', { name: nome, school: 'Escola', shift: 'FULL', monthlyFee: 100 });
    }

    const antes = await verifyChain(alfa.id);
    expect(antes.ok).toBe(true);
    expect(antes.checked).toBeGreaterThanOrEqual(3);

    // Edicao por FORA do sistema, que e exatamente o cenario que a cadeia
    // existe para denunciar: alguem com acesso ao banco reescrevendo a
    // descricao de um evento.
    const alvo = await runUnscoped('fixture', () =>
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "AuditLog" WHERE "companyId" = ${alfa.id} ORDER BY "createdAt" ASC OFFSET 1 LIMIT 1`,
    );
    const alvoId = alvo[0]!.id;

    await runUnscoped('fixture', () =>
      prisma.$executeRaw`UPDATE "AuditLog" SET description = 'nada aconteceu aqui' WHERE id = ${alvoId}`,
    );

    const depois = await verifyChain(alfa.id);
    expect(depois.ok).toBe(false);
    expect(depois.brokenAt).toBeDefined();
    expect(depois.brokenAt!.id).toBe(alvoId);

    // E a rota tem de contar isso a quem le: uma trilha quebrada usada como
    // prova e pior que trilha nenhuma.
    const res = await dono.get('/api/v1/privacy/audit-trail');
    expect(res.status).toBe(200);
    expect(res.body.chainIntegrity.ok).toBe(false);
  });
});

describe('cadeia de auditoria sob concorrencia', () => {
  /**
   * Gravar na trilha e ler-o-ultimo-depois-escrever. Sem serializacao, duas
   * acoes auditadas simultaneas da MESMA empresa liam o mesmo `prevHash` e
   * criavam dois elos apontando para o mesmo antecessor: a cadeia bifurcava e
   * `verifyChain` passava a acusar rompimento PARA SEMPRE — a trilha deixava de
   * servir como prova exatamente quando o sistema estava sendo mais usado.
   *
   * Este teste existe porque o defeito so aparece com escrita concorrente, que
   * e o caso normal em producao e o caso raro numa suite sequencial.
   */
  it('escritas simultaneas nao bifurcam a cadeia', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    // Vinte escritas auditadas ao mesmo tempo, todas na mesma empresa.
    const emParalelo = Array.from({ length: 20 }, (_, i) =>
      dono.post('/api/v1/students', {
        name: `Aluno Concorrente ${i}`,
        school: 'Escola da Corrida',
        shift: 'MORNING',
        monthlyFee: 100,
      }),
    );
    const respostas = await Promise.all(emParalelo);
    expect(respostas.every((r) => r.status === 201)).toBe(true);

    // A trilha e gravada fora do caminho da resposta; espera ate estabilizar.
    let anterior = -1;
    for (let tentativa = 0; tentativa < 40; tentativa++) {
      const [linha] = await runUnscoped('check', () =>
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "AuditLog"`,
      );
      const agora = Number(linha!.n);
      if (agora === anterior && agora >= 20) break;
      anterior = agora;
      await new Promise((r) => setTimeout(r, 100));
    }

    const empresa = await runUnscoped('check', () =>
      prisma.company.findFirst({ where: { document: '11222333000181' }, select: { id: true } }),
    );
    const cadeia = await verifyChain(empresa!.id);

    expect(cadeia.checked).toBeGreaterThanOrEqual(20);
    expect(cadeia.brokenAt, 'a cadeia bifurcou sob escrita concorrente').toBeUndefined();
    expect(cadeia.ok).toBe(true);

    // Nenhum `prevHash` pode ser reutilizado: dois elos com o mesmo antecessor
    // sao exatamente a bifurcacao, e `verifyChain` sozinho poderia nao ver o
    // ramo que ficou de fora da ordenacao.
    const repetidos = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ prevHash: string; n: bigint }>>`
        SELECT "prevHash", count(*) AS n FROM "AuditLog"
        WHERE "prevHash" IS NOT NULL GROUP BY "prevHash" HAVING count(*) > 1`,
    );
    expect(repetidos, 'ha prevHash reutilizado — a cadeia tem ramos').toHaveLength(0);
  });
});
