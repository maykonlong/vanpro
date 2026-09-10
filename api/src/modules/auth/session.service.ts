import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response, Request } from 'express';
import { prisma } from '../../lib/prisma';
import { runUnscoped } from '../../lib/request-context';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { Errors, AppError } from '../../lib/errors';

/**
 * Sessao em dois tokens.
 *
 *   access  — JWT curto (15 min), carrega as claims. Nunca vai no corpo da
 *             resposta: cookie httpOnly, e so. A versao anterior devolvia o
 *             token no JSON "so pro MVP do React", o que anulava inteiro o
 *             ganho do httpOnly.
 *   refresh — valor opaco aleatorio, guardado no banco apenas como HASH, com
 *             rotacao a cada uso e deteccao de reuso.
 *
 * Deteccao de reuso: se um refresh ja rotacionado aparece de novo, ou o token
 * vazou ou foi clonado. Nao da para saber qual das duas partes e a legitima,
 * entao a familia inteira e revogada e os dois lados refazem login. Preferimos
 * o atrito ao invasor com sessao viva.
 */

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/v1/auth';

export interface AccessClaims {
  sub: string;
  role: string;
  tenantId: string | null;
  sid: string;
  fam: string;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cookieBase() {
  return {
    httpOnly: true,
    // `secure` fora de local: cookie de sessao em texto claro na rede e o fim
    // de toda a cadeia de autenticacao.
    secure: env.APP_ENV !== 'local',
    sameSite: 'strict' as const,
    domain: env.COOKIE_DOMAIN,
  };
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'vanpro-api',
    audience: 'vanpro-web',
    algorithm: 'HS256',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    // `algorithms` explicito: sem isso, um token com alg=none ou alg trocado
    // pode ser aceito dependendo da versao da lib.
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'vanpro-api',
      audience: 'vanpro-web',
      algorithms: ['HS256'],
    }) as AccessClaims;
  } catch {
    throw Errors.unauthorized('Sessão expirada ou inválida.');
  }
}

function userAgentHash(req: Request): string {
  return hash(req.get('user-agent') ?? 'unknown');
}

export interface IssuedSession {
  accessToken: string;
  sessionId: string;
}

/**
 * Identidade da sessao.
 *
 * `companyId` e a empresa ATIVA — propriedade da sessao, nao do usuario. A
 * mesma pessoa pode ter sessoes simultaneas em frotas diferentes, que e o caso
 * do motorista freelancer. `role` e o papel DENTRO dessa empresa, e nao o papel
 * global: alguem pode ser dono de uma frota e motorista em outra.
 */
export interface SujeitoDaSessao {
  id: string;
  role: string;
  companyId: string | null;
}

/**
 * Como a sessao foi autenticada.
 *
 * `senha` e `passkey` sao UM fator. `senha+totp` e `passkey+uv` sao dois — no
 * segundo caso porque a chave exigiu biometria ou PIN no proprio dispositivo,
 * o que soma "algo que voce e/sabe" a "algo que voce tem".
 */
export type MetodoDeAutenticacao = 'senha' | 'senha+totp' | 'passkey' | 'passkey+uv';

export function temSegundoFator(metodo: string): boolean {
  return metodo === 'senha+totp' || metodo === 'passkey+uv';
}

/** Cria uma familia de sessao nova (login). */
export async function issueSession(
  req: Request,
  res: Response,
  user: SujeitoDaSessao,
  metodo: MetodoDeAutenticacao = 'senha',
): Promise<IssuedSession> {
  const familyId = crypto.randomUUID();
  return rotate(req, res, user, familyId, null, metodo);
}

async function rotate(
  req: Request,
  res: Response,
  user: SujeitoDaSessao,
  familyId: string,
  previousSessionId: string | null,
  metodo: MetodoDeAutenticacao = 'senha',
): Promise<IssuedSession> {
  const refreshRaw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await runUnscoped('session-write', () =>
    prisma.session.create({
      data: {
        userId: user.id,
        companyId: user.companyId,
        familyId,
        tokenHash: hash(refreshRaw),
        userAgentHash: userAgentHash(req),
        authMethod: metodo,
        ipAddress: req.ip ?? null,
        expiresAt,
      },
    }),
  );

  if (previousSessionId) {
    await runUnscoped('session-write', () =>
      prisma.session.update({
        where: { id: previousSessionId },
        data: { revokedAt: new Date(), replacedById: session.id },
      }),
    );
  }

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    tenantId: user.companyId,
    sid: session.id,
    fam: familyId,
  });

  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieBase(),
    path: '/',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshRaw, {
    ...cookieBase(),
    // Escopo estreito: o refresh so e enviado para as rotas de auth, entao ele
    // nao trafega em toda requisicao da aplicacao.
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  return { accessToken, sessionId: session.id };
}

/** Troca o refresh por um par novo. Lanca se detectar reuso. */
export async function refreshSession(req: Request, res: Response): Promise<IssuedSession> {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw || typeof raw !== 'string') throw Errors.unauthorized('Sessão ausente.');

  const session = await runUnscoped('session-read', () =>
    prisma.session.findUnique({
      where: { tokenHash: hash(raw) },
      include: { user: true },
    }),
  );

  if (!session) {
    clearSessionCookies(res);
    throw Errors.unauthorized('Sessão inválida.');
  }

  if (session.revokedAt) {
    // Reuso: token ja rotacionado voltou. Queima a familia inteira.
    await revokeFamily(session.familyId);
    clearSessionCookies(res);
    await audit({
      action: 'AUTH_REFRESH_REUSE_DETECTED',
      description: `Refresh token já utilizado foi reapresentado. Família ${session.familyId} revogada por precaução.`,
      userId: session.userId,
      ipAddress: req.ip ?? null,
    });
    logger.warn({ familyId: session.familyId }, 'reuso de refresh token detectado');
    throw new AppError(401, 'SESSION_REUSE', 'Sua sessão foi encerrada por segurança. Entre novamente.');
  }

  if (session.expiresAt < new Date()) {
    clearSessionCookies(res);
    throw Errors.unauthorized('Sessão expirada.');
  }

  if (!session.user.isActive) {
    await revokeFamily(session.familyId);
    clearSessionCookies(res);
    throw Errors.forbidden('Este acesso foi desativado.');
  }

  // Vinculo com o dispositivo. Nao e prova de posse (o User-Agent e enviado
  // pelo cliente e pode ser copiado junto com o cookie), mas eleva o custo do
  // replay cego e denuncia o caso mais comum de cookie exportado.
  if (session.userAgentHash !== userAgentHash(req)) {
    await revokeFamily(session.familyId);
    clearSessionCookies(res);
    await audit({
      action: 'AUTH_REFRESH_REUSE_DETECTED',
      description: 'Refresh apresentado de dispositivo diferente do que originou a sessão.',
      userId: session.userId,
      ipAddress: req.ip ?? null,
    });
    throw new AppError(401, 'SESSION_DEVICE_MISMATCH', 'Sessão encerrada por segurança. Entre novamente.');
  }

  // O papel e relido do vinculo a cada rotacao. Promover ou rebaixar alguem
  // precisa valer na proxima renovacao, e nao so no proximo login — e a empresa
  // ativa vem da SESSAO, para o freelancer nao ser jogado de volta na outra
  // frota a cada 15 minutos.
  const papel = await papelNaEmpresa(session.userId, session.companyId, session.user.role);
  if (!papel) {
    await revokeFamily(session.familyId);
    clearSessionCookies(res);
    throw Errors.forbidden('Seu vínculo com esta empresa não está mais ativo.');
  }

  return rotate(
    req,
    res,
    { id: session.user.id, role: papel, companyId: session.companyId },
    session.familyId,
    session.id,
    // O metodo ATRAVESSA a rotacao. Sem isto, quinze minutos depois de entrar
    // com senha + TOTP a sessao voltaria a valer como "senha" e perderia o
    // acesso ao console — ou, pior, o contrario: uma sessao de fator unico
    // ganharia o carimbo padrao e passaria a ser aceita.
    (session.authMethod as MetodoDeAutenticacao) ?? 'senha',
  );
}

/**
 * Papel da pessoa DENTRO da empresa ativa, ou `null` se o vinculo nao esta mais
 * ativo. Para SUPER_ADMIN (sem empresa) devolve o papel de plataforma.
 */
export async function papelNaEmpresa(
  userId: string,
  companyId: string | null,
  papelDePlataforma: string,
): Promise<string | null> {
  if (!companyId) return papelDePlataforma === 'SUPER_ADMIN' ? papelDePlataforma : null;

  const vinculo = await runUnscoped('session-role', () =>
    prisma.userCompany.findFirst({
      where: { userId, companyId, status: { in: ['ACTIVE', 'ARCHIVED'] } },
      select: { role: true },
    }),
  );
  return vinculo?.role ?? null;
}

export interface VinculoAtivo {
  companyId: string;
  companyName: string;
  role: string;
  contractType: string;
  status: string;
}

/**
 * Empresas em que a pessoa pode entrar hoje.
 *
 * `ARCHIVED` entra na lista de proposito: ex-funcionario mantem acesso de
 * leitura ao proprio historico, que e o que o protege num processo trabalhista.
 * Quem nao entra e quem foi suspenso ou apenas convidado sem aceitar.
 */
export async function vinculosAtivos(userId: string): Promise<VinculoAtivo[]> {
  const vinculos = await runUnscoped('session-bonds', () =>
    prisma.userCompany.findMany({
      where: { userId, status: { in: ['ACTIVE', 'ARCHIVED'] } },
      select: {
        companyId: true,
        role: true,
        contractType: true,
        status: true,
        company: { select: { name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    }),
  );

  return vinculos.map((v) => ({
    companyId: v.companyId,
    companyName: v.company.name,
    role: v.role,
    contractType: v.contractType,
    status: v.status,
  }));
}

/**
 * Troca a empresa ativa.
 *
 * A familia anterior e revogada e uma nova nasce, em vez de o `companyId` da
 * sessao existente ser reescrito. Assim um token de acesso emitido para a
 * frota A nunca passa a valer para a frota B durante os 15 minutos de vida que
 * ainda lhe restam — a troca e um corte, nao uma edicao.
 */
export async function switchCompany(
  req: Request,
  res: Response,
  userId: string,
  papelDePlataforma: string,
  companyIdDestino: string,
  familiaAtual: string | null,
): Promise<IssuedSession> {
  const papel = await papelNaEmpresa(userId, companyIdDestino, papelDePlataforma);
  if (!papel) throw Errors.forbidden('Você não tem vínculo ativo com esta empresa.');

  if (familiaAtual) await revokeFamily(familiaAtual);

  // Lembra a escolha para o proximo login sugerir a mesma frota.
  await runUnscoped('session-write', () =>
    prisma.user.update({ where: { id: userId }, data: { tenantId: companyIdDestino } }),
  );

  return issueSession(req, res, { id: userId, role: papel, companyId: companyIdDestino });
}

export async function revokeFamily(familyId: string): Promise<void> {
  await runUnscoped('session-write', () =>
    prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await runUnscoped('session-write', () =>
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  );
}

export async function sessionIsLive(sessionId: string): Promise<boolean> {
  const s = await runUnscoped('session-read', () =>
    prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true } }),
  );
  return Boolean(s && !s.revokedAt && s.expiresAt > new Date());
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: REFRESH_PATH });
}

export const cookieNames = { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_PATH };
