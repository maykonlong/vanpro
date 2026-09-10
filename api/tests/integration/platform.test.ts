import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { verifyChain } from '../../src/lib/audit';
import { authenticator } from 'otplib';
import {
  criarEmpresa,
  criarUsuario,
  autenticar,
  Cliente,
  SEGREDO_2FA_TESTE,
  type Empresa,
} from '../helpers/factory';

/**
 * Console da plataforma.
 *
 * Existe porque o produto suspendia a frota no fim do periodo de teste sem
 * nunca ter emitido a fatura do proprio plano — corte por inadimplencia de um
 * boleto que jamais chegou ao cliente. A decisao foi: vencimento vira AVISO
 * (`PAST_DUE`, ver `jobs.test.ts`) e cortar acesso passa a ser ato
 * administrativo, com responsavel, motivo e registro.
 *
 * O que estes testes protegem: que o ato so possa ser praticado por quem opera
 * a plataforma, que o motivo seja obrigatorio, e que o registro caia na trilha
 * da empresa AFETADA — que e onde a pergunta "por que eu fiquei fora do ar?"
 * nasce.
 */

let alfa: Empresa;
let beta: Empresa;

const PLATAFORMA = 'plataforma@teste.com.br';

beforeEach(async () => {
  alfa = await criarEmpresa('Frota Alfa', '11222333000181');
  beta = await criarEmpresa('Frota Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
  await criarUsuario(null, 'SUPER_ADMIN', PLATAFORMA);
});

async function estadoDe(companyId: string) {
  return runUnscoped('fixture', () =>
    prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantStatus: true, suspendedAt: true },
    }),
  );
}

describe('segundo fator na porta do console', () => {
  /*
   * O buraco que este bloco fecha.
   *
   * A primeira versao do guarda conferia `isTwoFactorEnabled` — a bandeira do
   * CADASTRO. Ela continua verdadeira para quem entra por passkey, que completa
   * o login sem TOTP nenhum e, sem verificacao de usuario, prova so POSSE da
   * chave. Um toque abria o console que suspende qualquer frota cliente.
   *
   * Agora o guarda le como ESTA SESSAO foi autenticada.
   */
  async function sessaoCom(metodo: string) {
    const c = new Cliente();
    const login = await c.login(PLATAFORMA);
    expect(login.body.requires2FA, 'a conta de plataforma precisa exigir 2FA').toBe(true);
    const segunda = await c.post('/api/v1/auth/2fa/login', {
      challengeId: login.body.challengeId,
      code: authenticator.generate(SEGREDO_2FA_TESTE),
    });
    expect(segunda.status).toBe(200);

    // Reescreve o metodo da sessao para simular o caminho alternativo de login
    // sem repetir a cerimonia WebAuthn inteira dentro do teste.
    await runUnscoped('fixture', () =>
      prisma.session.updateMany({ where: { revokedAt: null }, data: { authMethod: metodo } }),
    );
    return c;
  }

  it('sessao de senha+totp entra', async () => {
    const c = await sessaoCom('senha+totp');
    expect((await c.get('/api/v1/platform/companies')).status).toBe(200);
  });

  it('sessao de passkey COM verificacao do usuario entra', async () => {
    // Biometria ou PIN no dispositivo soma "algo que voce e/sabe" a "algo que
    // voce tem" — sao dois fatores de verdade.
    const c = await sessaoCom('passkey+uv');
    expect((await c.get('/api/v1/platform/companies')).status).toBe(200);
  });

  it('sessao de passkey SEM verificacao e recusada — posse sozinha e um fator', async () => {
    const c = await sessaoCom('passkey');
    const res = await c.get('/api/v1/platform/companies');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('segundo fator');
  });

  it('sessao so de senha e recusada, mesmo com 2FA cadastrado na conta', async () => {
    const c = await sessaoCom('senha');
    expect((await c.get('/api/v1/platform/companies')).status).toBe(403);
  });

  it('a recusa vale tambem para a ESCRITA, nao so para a listagem', async () => {
    const c = await sessaoCom('passkey');
    const res = await c.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'tentativa a partir de sessao de fator unico',
    });
    expect(res.status).toBe(403);
    expect((await estadoDe(alfa.id))!.tenantStatus).not.toBe('SUSPENDED');
  });
});

describe('quem pode operar o console', () => {
  it('o dono de uma frota nao enxerga a lista de frotas da plataforma', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get('/api/v1/platform/companies');
    expect(res.status).toBe(403);
  });

  it('o dono de uma frota nao consegue suspender ninguem — nem a si mesmo', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.patch(`/api/v1/platform/companies/${beta.id}/status`, {
      status: 'SUSPENDED',
      reason: 'tentativa indevida a partir de uma frota',
    });
    expect(res.status).toBe(403);
    expect((await estadoDe(beta.id))!.tenantStatus).not.toBe('SUSPENDED');
  });

  it('a plataforma enxerga todas as frotas, sem precisar de empresa ativa na sessao', async () => {
    const admin = await autenticar(PLATAFORMA);
    const res = await admin.get('/api/v1/platform/companies');

    expect(res.status).toBe(200);
    const nomes = res.body.items.map((c: { name: string }) => c.name);
    expect(nomes).toContain('Frota Alfa');
    expect(nomes).toContain('Frota Beta');
  });

  it('a lista nao devolve o documento inteiro da empresa', async () => {
    const admin = await autenticar(PLATAFORMA);
    const res = await admin.get('/api/v1/platform/companies');

    // O console serve para decidir sobre assinatura, nao para virar uma lista
    // de CNPJ exportavel: so os quatro ultimos digitos saem, o suficiente para
    // conferir com o cliente ao telefone.
    for (const c of res.body.items as Array<{ document: string }>) {
      expect(c.document).toMatch(/^\*\*\*\d{4}$/);
    }
    const alvo = res.body.items.find((c: { name: string }) => c.name === 'Frota Alfa');
    expect(alvo.document).toBe('***0181');
  });
});

describe('mudanca de estado da assinatura', () => {
  it('suspende, marca a data e registra o motivo na trilha da empresa afetada', async () => {
    const admin = await autenticar(PLATAFORMA);
    const res = await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'inadimplencia confirmada apos contato em 10/09',
    });

    expect(res.status).toBe(200);
    const estado = await estadoDe(alfa.id);
    expect(estado!.tenantStatus).toBe('SUSPENDED');
    expect(estado!.suspendedAt).not.toBeNull();

    const trilha = await runUnscoped('fixture', () =>
      prisma.auditLog.findMany({
        where: { companyId: alfa.id, action: 'COMPANY_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.description).toContain('inadimplencia confirmada');
    // O registro cai na trilha da empresa afetada, e nao na da plataforma.
    expect(trilha[0]!.companyId).toBe(alfa.id);

    // E a cadeia continua integra depois de uma escrita feita por fora da
    // empresa: `audit()` roda sem escopo, e este e o caminho mais facil de
    // quebrar sem ninguem notar.
    expect((await verifyChain(alfa.id)).ok).toBe(true);
  });

  it('reativar limpa a data de suspensao', async () => {
    const admin = await autenticar(PLATAFORMA);
    await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'corte por falta de pagamento do plano',
    });
    const res = await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'ACTIVE',
      reason: 'pagamento recebido por transferencia em 11/09',
    });

    expect(res.status).toBe(200);
    const estado = await estadoDe(alfa.id);
    expect(estado!.tenantStatus).toBe('ACTIVE');
    // Data velha sobrevivente faria o proximo relatorio contar como suspensa
    // uma frota que voltou a operar.
    expect(estado!.suspendedAt).toBeNull();
  });

  it('recusa mudanca sem motivo, e sem motivo de verdade', async () => {
    const admin = await autenticar(PLATAFORMA);

    const semMotivo = await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
    });
    expect(semMotivo.status).toBe(422);

    const motivoVazio = await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'x',
    });
    expect(motivoVazio.status).toBe(422);

    expect((await estadoDe(alfa.id))!.tenantStatus).not.toBe('SUSPENDED');
  });

  it('mudar para o estado em que a empresa ja esta e recusado, e nao vira registro duplicado', async () => {
    const admin = await autenticar(PLATAFORMA);
    await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'primeiro corte, este e o legitimo',
    });

    const repetido = await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'segunda tentativa, deve ser recusada',
    });
    expect(repetido.status).toBe(409);

    const trilha = await runUnscoped('fixture', () =>
      prisma.auditLog.count({ where: { companyId: alfa.id, action: 'COMPANY_STATUS_CHANGED' } }),
    );
    expect(trilha).toBe(1);
  });

  it('suspender uma frota nao encosta na outra', async () => {
    const admin = await autenticar(PLATAFORMA);
    await admin.patch(`/api/v1/platform/companies/${alfa.id}/status`, {
      status: 'SUSPENDED',
      reason: 'corte pontual de uma unica frota',
    });

    expect((await estadoDe(beta.id))!.tenantStatus).not.toBe('SUSPENDED');
  });

  it('empresa inexistente devolve 404, e nao 500', async () => {
    const admin = await autenticar(PLATAFORMA);
    const res = await admin.patch(
      '/api/v1/platform/companies/00000000-0000-4000-8000-000000000000/status',
      { status: 'SUSPENDED', reason: 'empresa que nao existe no banco' },
    );
    expect(res.status).toBe(404);
  });
});
