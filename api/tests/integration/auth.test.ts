import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { app, criarEmpresa, criarUsuario, autenticar, Cliente, SENHA, type Empresa } from '../helpers/factory';

/**
 * Autenticacao ponta a ponta contra o banco de verdade.
 *
 * O foco aqui nao e "o login funciona", e sim as promessas que o modulo faz e
 * que so um teste de integracao consegue cobrar: a resposta identica para conta
 * inexistente e senha errada, o bloqueio que cresce, o codigo de recuperacao
 * que morre depois do uso, e a familia de refresh que e queimada inteira quando
 * um token ja rotacionado reaparece.
 */

const NOVA_SENHA = 'OutraSenhaForte@2027';

let alfa: Empresa;

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
});

/** Cookie cru pelo nome, para os testes que precisam manipular a sessao a mao. */
function cookie(res: request.Response, nome: string): string | null {
  const set = res.headers['set-cookie'];
  if (!set) return null;
  const lista = Array.isArray(set) ? set : [set];
  for (const c of lista) {
    const [par] = c.split(';');
    if (par.split('=')[0] === nome && !par.endsWith('=')) return par;
  }
  return null;
}

/**
 * `/auth/refresh` viaja com o refresh_token, entao ele TAMBEM passa pelo
 * double-submit de CSRF — por design. Estes testes montam a requisicao a mao
 * (precisam guardar o refresh antigo), logo repetem o par cookie+header aqui.
 */
function refresh(refreshCookie: string, csrfCookie: string, ip: string) {
  const csrfValor = csrfCookie.slice('csrf_token='.length);
  return request(app())
    .post('/api/v1/auth/refresh')
    .set('user-agent', 'vitest-suite')
    .set('x-forwarded-for', ip)
    .set('x-csrf-token', csrfValor)
    .set('Cookie', [refreshCookie, csrfCookie].join('; '));
}

describe('login', () => {
  it('entra com a senha correta e devolve sessao em cookie httpOnly', async () => {
    const c = new Cliente();
    const res = await c.login('dono.alfa@teste.com.br');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('dono.alfa@teste.com.br');
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.csrfToken).toBeTypeOf('string');
    // Token no corpo anularia o httpOnly: o front nao pode alcancar o access.
    expect(res.body).not.toHaveProperty('accessToken');
    expect(res.body).not.toHaveProperty('token');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((x) => x.startsWith('access_token='))!;
    expect(access).toContain('HttpOnly');
    expect(access).toContain('SameSite=Strict');

    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.tenantId).toBe(alfa.id);
  });

  it('responde exatamente igual para senha errada e para e-mail inexistente', async () => {
    const errada = await new Cliente().login('dono.alfa@teste.com.br', 'SenhaTotalmenteErrada@1');
    const inexistente = await new Cliente().login('ninguem@teste.com.br', 'SenhaTotalmenteErrada@1');

    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    // Byte a byte: qualquer diferenca aqui vira um verificador de e-mails cadastrados.
    expect(errada.body.error.code).toBe(inexistente.body.error.code);
    expect(errada.body.error.message).toBe(inexistente.body.error.message);
    expect(errada.body.error.message).toBe('E-mail ou senha incorretos.');
  });

  it('bloqueia a conta na 5a falha e alonga a janela na falha seguinte', async () => {
    const c = new Cliente();
    for (let i = 0; i < 5; i++) {
      const r = await c.login('dono.alfa@teste.com.br', 'SenhaErrada@123');
      expect(r.status).toBe(401);
    }

    const depois = await runUnscoped('check', () =>
      prisma.user.findUnique({
        where: { email: 'dono.alfa@teste.com.br' },
        select: { failedLoginCount: true, lockedUntil: true },
      }),
    );
    expect(depois!.failedLoginCount).toBe(5);
    expect(depois!.lockedUntil).not.toBeNull();
    const primeiraJanela = depois!.lockedUntil!.getTime() - Date.now();

    // Senha CERTA agora tambem e recusada: o bloqueio vale para a conta, nao
    // para a tentativa.
    const comSenhaCerta = await c.login('dono.alfa@teste.com.br');
    expect(comSenhaCerta.status).toBe(423);
    expect(comSenhaCerta.body.error.code).toBe('ACCOUNT_LOCKED');

    // Libera a trava sem zerar o contador, que e o que o relogio faria, e erra
    // de novo: a janela precisa ser maior que a anterior (progressivo).
    await runUnscoped('fixture', () =>
      prisma.user.update({ where: { email: 'dono.alfa@teste.com.br' }, data: { lockedUntil: null } }),
    );
    await c.login('dono.alfa@teste.com.br', 'SenhaErrada@123');

    const segunda = await runUnscoped('check', () =>
      prisma.user.findUnique({
        where: { email: 'dono.alfa@teste.com.br' },
        select: { failedLoginCount: true, lockedUntil: true },
      }),
    );
    expect(segunda!.failedLoginCount).toBe(6);
    expect(segunda!.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(primeiraJanela);
  });

  it('recusa senha vencida (90 dias) mesmo com a senha correta', async () => {
    await runUnscoped('fixture', () =>
      prisma.user.update({
        where: { email: 'dono.alfa@teste.com.br' },
        data: { passwordUpdatedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
      }),
    );

    const res = await new Cliente().login('dono.alfa@teste.com.br');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_EXPIRED');
    expect(cookie(res, 'access_token')).toBeNull();
  });

  it('zera o contador de falhas quando o login enfim da certo', async () => {
    const c = new Cliente();
    await c.login('dono.alfa@teste.com.br', 'SenhaErrada@123');
    await c.login('dono.alfa@teste.com.br', 'SenhaErrada@123');

    const ok = await c.login('dono.alfa@teste.com.br');
    expect(ok.status).toBe(200);

    const user = await runUnscoped('check', () =>
      prisma.user.findUnique({
        where: { email: 'dono.alfa@teste.com.br' },
        select: { failedLoginCount: true, lockedUntil: true },
      }),
    );
    expect(user!.failedLoginCount).toBe(0);
    expect(user!.lockedUntil).toBeNull();
  });
});

describe('verificacao em duas etapas', () => {
  /** setup + activate; devolve o segredo TOTP e os codigos de recuperacao. */
  async function ativar2FA() {
    const c = await autenticar('dono.alfa@teste.com.br');

    const setup = await c.post('/api/v1/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    const secret: string = setup.body.secret;

    // Ate aqui o 2FA NAO esta ativo: quem fecha a tela antes de ler o QR nao
    // pode ficar trancado para fora da propria conta.
    const meio = await runUnscoped('check', () =>
      prisma.user.findUnique({
        where: { email: 'dono.alfa@teste.com.br' },
        select: { isTwoFactorEnabled: true },
      }),
    );
    expect(meio!.isTwoFactorEnabled).toBe(false);

    const activate = await c.post('/api/v1/auth/2fa/activate', {
      code: authenticator.generate(secret),
    });
    expect(activate.status).toBe(200);
    expect(activate.body.recoveryCodes).toHaveLength(10);

    return { secret, recoveryCodes: activate.body.recoveryCodes as string[] };
  }

  it('ativa, exige o segundo fator no login e aceita o codigo do app', async () => {
    const { secret } = await ativar2FA();

    const c = new Cliente();
    const login = await c.login('dono.alfa@teste.com.br');
    expect(login.status).toBe(200);
    expect(login.body.requires2FA).toBe(true);
    expect(login.body.challengeId).toBeTypeOf('string');
    // O desafio nao pode servir de sessao: nada de cookie de acesso ainda.
    expect(cookie(login, 'access_token')).toBeNull();

    const segunda = await c.post('/api/v1/auth/2fa/login', {
      challengeId: login.body.challengeId,
      code: authenticator.generate(secret),
    });
    expect(segunda.status).toBe(200);
    expect(segunda.body.user.email).toBe('dono.alfa@teste.com.br');

    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
  });

  it('aceita codigo de recuperacao uma vez e recusa o mesmo codigo na segunda', async () => {
    const { recoveryCodes } = await ativar2FA();
    const codigo = recoveryCodes[0]!;

    const primeiro = new Cliente();
    const desafio1 = await primeiro.login('dono.alfa@teste.com.br');
    const usa = await primeiro.post('/api/v1/auth/2fa/login', {
      challengeId: desafio1.body.challengeId,
      code: codigo,
    });
    expect(usa.status).toBe(200);

    const restantes = await runUnscoped('check', () =>
      prisma.user.findUnique({
        where: { email: 'dono.alfa@teste.com.br' },
        select: { twoFactorRecoveryCodes: true },
      }),
    );
    expect(JSON.parse(restantes!.twoFactorRecoveryCodes!)).toHaveLength(9);

    const segundo = new Cliente();
    const desafio2 = await segundo.login('dono.alfa@teste.com.br');
    const reusa = await segundo.post('/api/v1/auth/2fa/login', {
      challengeId: desafio2.body.challengeId,
      code: codigo,
    });
    expect(reusa.status).toBe(401);
    expect(cookie(reusa, 'access_token')).toBeNull();
  });
});

describe('sessao', () => {
  it('rotaciona o refresh: o token velho deixa de valer e o novo vale', async () => {
    const login = await request(app())
      .post('/api/v1/auth/login')
      .set('user-agent', 'vitest-suite')
      .set('x-forwarded-for', '10.90.0.1')
      .send({ email: 'dono.alfa@teste.com.br', password: SENHA });
    expect(login.status).toBe(200);

    const refreshAntigo = cookie(login, 'refresh_token')!;
    const csrf = cookie(login, 'csrf_token')!;
    expect(refreshAntigo).toBeTruthy();

    const rotacao = await refresh(refreshAntigo, csrf, '10.90.0.1');
    expect(rotacao.status).toBe(200);

    const refreshNovo = cookie(rotacao, 'refresh_token')!;
    expect(refreshNovo).not.toBe(refreshAntigo);

    // A sessao antiga foi marcada como substituida, e nao apenas esquecida.
    const sessoes = await runUnscoped('check', () =>
      prisma.session.findMany({ orderBy: { createdAt: 'asc' }, select: { revokedAt: true, replacedById: true } }),
    );
    expect(sessoes).toHaveLength(2);
    expect(sessoes[0]!.revokedAt).not.toBeNull();
    expect(sessoes[0]!.replacedById).not.toBeNull();
  });

  it('reapresentar um refresh ja usado queima a familia inteira', async () => {
    const login = await request(app())
      .post('/api/v1/auth/login')
      .set('user-agent', 'vitest-suite')
      .set('x-forwarded-for', '10.90.0.2')
      .send({ email: 'dono.alfa@teste.com.br', password: SENHA });

    const refreshAntigo = cookie(login, 'refresh_token')!;
    const csrf = cookie(login, 'csrf_token')!;
    const rotacao = await refresh(refreshAntigo, csrf, '10.90.0.2');
    expect(rotacao.status).toBe(200);
    const refreshNovo = cookie(rotacao, 'refresh_token')!;
    const accessNovo = cookie(rotacao, 'access_token')!;
    const csrfNovo = cookie(rotacao, 'csrf_token') ?? csrf;

    const reuso = await refresh(refreshAntigo, csrf, '10.90.0.2');
    expect(reuso.status).toBe(401);
    expect(reuso.body.error.code).toBe('SESSION_REUSE');

    // O ponto do teste: nao basta recusar o token velho. O token BOM, que estava
    // com a vitima, tambem tem de morrer — nao da para saber qual das duas
    // pontas e a legitima.
    const comTokenBom = await refresh(refreshNovo, csrfNovo, '10.90.0.2');
    expect(comTokenBom.status).toBe(401);

    const comAccessBom = await request(app())
      .get('/api/v1/auth/me')
      .set('user-agent', 'vitest-suite')
      .set('x-forwarded-for', '10.90.0.2')
      .set('Cookie', accessNovo);
    expect(comAccessBom.status).toBe(401);

    const vivas = await runUnscoped('check', () =>
      prisma.session.count({ where: { revokedAt: null } }),
    );
    expect(vivas).toBe(0);
  });

  it('logout derruba a sessao na chamada seguinte, sem esperar o token expirar', async () => {
    const c = await autenticar('dono.alfa@teste.com.br');
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);

    const saida = await c.post('/api/v1/auth/logout');
    expect(saida.status).toBe(204);

    const depois = await c.get('/api/v1/auth/me');
    expect(depois.status).toBe(401);
  });

  it('trocar a senha revoga as outras sessoes e mantem a que trocou', async () => {
    const dispositivoA = await autenticar('dono.alfa@teste.com.br');
    const dispositivoB = await autenticar('dono.alfa@teste.com.br');
    expect((await dispositivoB.get('/api/v1/auth/me')).status).toBe(200);

    const troca = await dispositivoA.post('/api/v1/auth/change-password', {
      currentPassword: SENHA,
      newPassword: NOVA_SENHA,
    });
    expect(troca.status).toBe(200);

    expect((await dispositivoB.get('/api/v1/auth/me')).status).toBe(401);
    expect((await dispositivoA.get('/api/v1/auth/me')).status).toBe(200);

    // A senha nova e a que passa a valer.
    expect((await new Cliente().login('dono.alfa@teste.com.br', SENHA)).status).toBe(401);
    expect((await new Cliente().login('dono.alfa@teste.com.br', NOVA_SENHA)).status).toBe(200);
  });

  it('lista somente as proprias sessoes e nao revoga a de outra pessoa', async () => {
    await criarUsuario(alfa, 'MANAGER', 'gestor.alfa@teste.com.br');

    const dono1 = await autenticar('dono.alfa@teste.com.br');
    await autenticar('dono.alfa@teste.com.br');
    const gestor = await autenticar('gestor.alfa@teste.com.br');

    const lista = await dono1.get('/api/v1/auth/sessions');
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(2);
    expect(lista.body.items.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const doGestor = await gestor.get('/api/v1/auth/sessions');
    const idDoGestor: string = doGestor.body.items[0].id;
    // Nenhum id do gestor pode aparecer na lista do dono.
    expect(lista.body.items.map((s: { id: string }) => s.id)).not.toContain(idDoGestor);

    // 404 e nao 403: confirmar que o id existe ja seria informacao a mais.
    const tentativa = await dono1.delete(`/api/v1/auth/sessions/${idDoGestor}`);
    expect(tentativa.status).toBe(404);
    expect((await gestor.get('/api/v1/auth/me')).status).toBe(200);
  });
});
