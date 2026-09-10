import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/lib/prisma';
import { runUnscoped } from '../../src/lib/request-context';
import { createApp } from '../../src/http/app';
import { toCents } from '../../src/lib/money';

/**
 * Fabrica de cenario para os testes de integracao.
 *
 * Tudo aqui grava no PostgreSQL de verdade. Nao ha mock de banco de proposito:
 * as 71 fixtures da versao anterior passavam enquanto o sistema real vazava
 * dados entre empresas — fixture testa a unidade, so o banco testa o sistema.
 */

export const SENHA = 'TesteForte@2026';

let cachedApp: Express | null = null;
export function app(): Express {
  cachedApp ??= createApp();
  return cachedApp;
}

export type Papel = 'OWNER' | 'MANAGER' | 'DRIVER' | 'ASSISTANT' | 'PARENT' | 'SUPER_ADMIN';

export interface Empresa {
  id: string;
  name: string;
  planId: string;
}

export async function criarPlano(name = 'PRO', limites?: Partial<{ maxVehicles: number; maxDrivers: number; maxStudents: number }>) {
  return runUnscoped('test-factory', () =>
    prisma.subscriptionPlan.upsert({
      where: { name },
      update: {},
      create: {
        name,
        maxVehicles: limites?.maxVehicles ?? 20,
        maxDrivers: limites?.maxDrivers ?? 40,
        maxStudents: limites?.maxStudents ?? 500,
        priceCents: toCents(249.9),
      },
    }),
  );
}

export async function criarEmpresa(
  name: string,
  document: string,
  opts: { tenantStatus?: string; planName?: string; limites?: Parameters<typeof criarPlano>[1] } = {},
): Promise<Empresa> {
  const plano = await criarPlano(opts.planName ?? `PLANO_${document}`, opts.limites);
  const company = await runUnscoped('test-factory', () =>
    prisma.company.create({
      data: {
        name,
        document,
        subscriptionId: plano.id,
        tenantStatus: opts.tenantStatus ?? 'ACTIVE',
      },
    }),
  );
  return { id: company.id, name: company.name, planId: plano.id };
}

export interface Usuario {
  id: string;
  email: string;
  role: Papel;
  companyId: string | null;
}

/**
 * Segredo TOTP fixo para as fixtures que precisam de segundo fator.
 *
 * O console da plataforma exige 2FA (senha sozinha nao pode suspender uma
 * frota), entao o SUPER_ADMIN de teste precisa nascer com ele ativo — do
 * contrario o teste mediria a recusa do 2FA, e nao a regra que quer provar.
 */
export const SEGREDO_2FA_TESTE = 'KRSXG5CTMVRXEZLUGE3TMNZS';

export async function criarUsuario(
  empresa: Empresa | null,
  role: Papel,
  email: string,
  flags: Partial<{ canManageFinance: boolean; canManageHR: boolean; canManageRoutes: boolean }> = {},
  status = 'ACTIVE',
): Promise<Usuario> {
  const hash = await bcrypt.hash(SENHA, 4); // custo baixo: a suite roda centenas de vezes
  const user = await runUnscoped('test-factory', () =>
    prisma.user.create({
      data: {
        name: `Usuario ${role}`,
        email,
        password: hash,
        role,
        tenantId: empresa?.id ?? null,
        // Só quem opera a plataforma nasce com segundo fator: é a única porta
        // que o exige, e ligá-lo para todos faria cada login de fixture pagar
        // uma etapa que a rota sob teste não pede.
        ...(role === 'SUPER_ADMIN'
          ? { isTwoFactorEnabled: true, twoFactorSecret: SEGREDO_2FA_TESTE }
          : {}),
      },
    }),
  );

  if (empresa) {
    await runUnscoped('test-factory', () =>
      prisma.userCompany.create({
        data: {
          userId: user.id,
          companyId: empresa.id,
          role,
          status,
          canManageFinance: flags.canManageFinance ?? role === 'OWNER',
          canManageHR: flags.canManageHR ?? role === 'OWNER',
          canManageRoutes: flags.canManageRoutes ?? role === 'OWNER',
        },
      }),
    );
  }

  return { id: user.id, email, role, companyId: empresa?.id ?? null };
}

/**
 * Agente HTTP autenticado.
 *
 * Guarda os cookies (sessao + CSRF) e reenvia o header `x-csrf-token`, porque
 * o app exige double-submit em toda escrita. Se este helper "simplificasse"
 * desligando o CSRF, a suite deixaria de exercitar a defesa que mais depende de
 * estar ligada em toda rota.
 */
let proximoIp = 0;
/**
 * Cada Cliente fala de um IP diferente.
 *
 * `globalLimiter` (1000/15min) e `authLimiter` (10 falhas/15min) sao singletons
 * de modulo com store em memoria durante o teste, e a chave deles e o IP. Com
 * todos os clientes vindo de 127.0.0.1 a cota seria da SUITE INTEIRA: o teste
 * de bloqueio progressivo gastaria metade dela e os arquivos seguintes
 * receberiam 429 por causa de um vizinho. O app roda com `trust proxy: 1`,
 * entao o X-Forwarded-For define `req.ip` e cada cliente ganha sua propria cota.
 */
function ipDeTeste(): string {
  proximoIp += 1;
  return `10.${(proximoIp >> 16) & 0xff}.${(proximoIp >> 8) & 0xff}.${proximoIp & 0xff}`;
}

export class Cliente {
  private cookies: string[] = [];
  private csrf: string | null = null;
  readonly ip = ipDeTeste();

  constructor(private readonly express: Express = app()) {}

  private absorver(res: request.Response) {
    const set = res.headers['set-cookie'];
    if (set) {
      const novos = Array.isArray(set) ? set : [set];
      for (const c of novos) {
        const [pair] = c.split(';');
        const nome = pair.split('=')[0];
        this.cookies = this.cookies.filter((existing) => existing.split('=')[0] !== nome);
        if (!pair.endsWith('=')) this.cookies.push(pair);
        if (nome === 'csrf_token') this.csrf = pair.slice('csrf_token='.length);
      }
    }
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }

  private header() {
    const h: Record<string, string> = { 'user-agent': 'vitest-suite', 'x-forwarded-for': this.ip };
    if (this.cookies.length) h.Cookie = this.cookies.join('; ');
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    return h;
  }

  async login(email: string, senha = SENHA) {
    const res = await request(this.express)
      .post('/api/v1/auth/login')
      .set('user-agent', 'vitest-suite')
      .set('x-forwarded-for', this.ip)
      .send({ email, password: senha });
    this.absorver(res);
    return res;
  }

  get(url: string) {
    return request(this.express).get(url).set(this.header());
  }
  async post(url: string, body?: unknown) {
    const res = await request(this.express).post(url).set(this.header()).send(body as object);
    return this.absorver(res);
  }
  async patch(url: string, body?: unknown) {
    const res = await request(this.express).patch(url).set(this.header()).send(body as object);
    return this.absorver(res);
  }
  async delete(url: string) {
    const res = await request(this.express).delete(url).set(this.header());
    return this.absorver(res);
  }

  /**
   * Envio de arquivo (multipart), com a mesma sessao e o mesmo CSRF.
   *
   * Existe porque o unico caminho de escrita que nao passa por JSON e o upload
   * — e era justamente o que nenhum teste exercitava: a validacao de assinatura
   * do conteudo (magic bytes) e a pasta por empresa viviam sem prova.
   */
  async upload(url: string, campo: string, nome: string, buffer: Buffer, tipo: string) {
    const res = await request(this.express)
      .post(url)
      .set(this.header())
      .attach(campo, buffer, { filename: nome, contentType: tipo });
    return this.absorver(res);
  }

  /** Para os testes de CSRF: mesma sessao, sem o header. */
  postSemCsrf(url: string, body?: unknown) {
    const h = this.header();
    delete h['x-csrf-token'];
    return request(this.express).post(url).set(h).send(body as object);
  }
}

/** Cenario padrao: duas empresas, para todo teste poder tentar atravessar. */
export async function cenarioDuasEmpresas() {
  const alfa = await criarEmpresa('Empresa Alfa', '11222333000181');
  const beta = await criarEmpresa('Empresa Beta', '44555666000199');

  const donoAlfa = await criarUsuario(alfa, 'OWNER', 'dono.alfa@teste.com.br');
  const donoBeta = await criarUsuario(beta, 'OWNER', 'dono.beta@teste.com.br');

  return { alfa, beta, donoAlfa, donoBeta };
}

export async function autenticar(email: string) {
  const c = new Cliente();
  let res = await c.login(email);
  if (res.status !== 200) {
    throw new Error(`login de ${email} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  }

  /*
   * Segunda etapa quando a conta exige segundo fator.
   *
   * O SUPER_ADMIN de fixture nasce com 2FA porque o console da plataforma o
   * exige. Sem este trecho, todo teste de plataforma mediria a ausencia da
   * sessao — e passaria pelos motivos errados.
   */
  if (res.body?.requires2FA) {
    res = await c.post('/api/v1/auth/2fa/login', {
      challengeId: res.body.challengeId,
      code: authenticator.generate(SEGREDO_2FA_TESTE),
    });
    if (res.status !== 200) {
      throw new Error(`2FA de ${email} falhou: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
  return c;
}
